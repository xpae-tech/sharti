// Messaging: send message, stream reply, stop, retry, persist.
// Handles file upload, constructs the new parts-based message format,
// and orchestrates the MCP tool-calling agent loop.

import { S, currentConv, apiName, reasoningEffortToSend, isExternalApiActive, externalModelId, currentTuning, acceptsImages, contextLimit } from '../../core/state.js';
import { api } from '../../core/api.js';
import { REQUEST, STREAM } from '../../core/config.js';
import { refreshNativeToolsState } from '../../core/native-tools.js';
import { contextFigure, compactNum, fmtDuration } from '../../core/format.js';
import { readReasoningDelta, reasoningText } from '../../../../shared/reasoning.js';
import { readTokensPerSecond } from '../../../../shared/stream-metrics.js';
import { readUsage } from '../../../../shared/usage.js';
import { buildChatRequestBody } from './request-body.js';
import { openChatStream } from './chat-stream.js';
import { executeMcpTool, findServerForTool, getActiveToolDefs, toOpenAiTool } from './tool-runtime.js';
import { bumpConversationOrder, createAssistantMessage, ensureConversation, persistConversation, uid } from './session.js';
import { blobToDataUrl, buildInitialWireMessages, resolveChatFileDataUrl } from './wire.js';
import { createToolApprovalGate } from './tool-approval.js';
import { formatChatError } from './errors.js';
import { isPdfFile } from '../../types';
import type { Elements, Conversation, ChatMessage, Part, TextPart, ImagePart, FilePart, ThreadSegment } from '../../types';

interface AccToolCall {
  id: string;
  functionName: string;
  argumentsStr: string;
}

interface MessengerDeps {
  autosize: () => void;
  renderAttachments: () => void;
  renderChatSidebar: () => void;
  renderConversation: () => void;
  renderComposer: () => void;
  showPage: () => void;
  scrollToBottom: () => void;
  updateLiveMessage: (amsg: ChatMessage) => void;
}

export function createMessenger(E: Elements, deps: MessengerDeps) {
  const approval = createToolApprovalGate();

  async function sendMessage(): Promise<void> {
    const text = S.draft.text.trim();
    const draftAttachments = S.draft.attachments.slice();
    const conv = await ensureConversation();
    if (!conv.name) conv.name = (text.split('\n')[0] || 'Attachment').slice(0, 80);

    const attachmentParts: Part[] = [];
    const sessionDataUrls = new Map<string, string>();
    for (const attachment of draftAttachments) {
      try {
        const fd = new FormData();
        fd.append('file', attachment.file, attachment.file.name);
        const meta = await api('POST', `/api/chats/${encodeURIComponent(conv.id)}/files`, undefined, fd);
        const isImage = meta.mimeType?.startsWith('image/');
        if (isImage || meta.mimeType === 'application/pdf' || isPdfFile(attachment.file)) {
          // Images are read for their preview; PDFs are read here, at send
          // time, so the composer never holds a full unused base64 copy.
          let dataUrl = attachment.dataUrl;
          if (!dataUrl) {
            try { dataUrl = await blobToDataUrl(attachment.file); } catch { /* resolve later */ }
          }
          if (dataUrl) sessionDataUrls.set(meta.fileName, dataUrl);
        }
        if (isImage) {
          attachmentParts.push({ type: 'image', fileName: meta.fileName, mimeType: meta.mimeType } satisfies ImagePart);
        } else if (meta.mimeType === 'application/pdf' || isPdfFile(attachment.file)) {
          attachmentParts.push({
            type: 'file',
            fileName: meta.fileName,
            mimeType: meta.mimeType || 'application/pdf',
            originalName: meta.originalName || attachment.file.name,
          } satisfies FilePart);
        }
      } catch (e) {
        console.warn('Failed to upload attachment:', e);
      }
    }

    const userParts: Part[] = [];
    if (text) userParts.push({ type: 'text', text } satisfies TextPart);
    userParts.push(...attachmentParts);

    const umsg: ChatMessage = { id: uid(), role: 'user', parts: userParts, ts: Date.now() };
    conv.messages.push(umsg);

    const amsg = createAssistantMessage();

    conv.messages.push(amsg);
    S.draft = { text: '', attachments: [] };
    S.drafts.delete(conv.id);
    E.composerInput.value = '';
    deps.autosize();
    deps.renderAttachments();
    await persistConversation(conv);
    S.streaming = conv.id;
    deps.renderChatSidebar();
    deps.renderConversation();
    deps.renderComposer();
    deps.showPage();
    deps.scrollToBottom();
    streamReply(conv, amsg, sessionDataUrls);
  }

  function buildRequestBody(messages: Array<Record<string, unknown>>): Record<string, unknown> {
    const external = isExternalApiActive();
    return buildChatRequestBody({
      messages,
      modelId: external ? externalModelId() : '',
      effort: reasoningEffortToSend(),
      tools: getActiveToolDefs().map(toOpenAiTool),
      isExternal: external,
      tuning: S.prefs.tuning,
      serveOptions: S.prefs.options,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STREAM REPLIES — the core agent loop with smooth streaming & thread segments
  // ─────────────────────────────────────────────────────────────────────────

  async function streamReply(conv: Conversation, amsg: ChatMessage, sessionDataUrls: Map<string, string>): Promise<void> {
    const ctl = new AbortController();
    S.streamAbort = ctl;
    let full = '', reasoning = '', tps: number | null = null, input: number | null = null, output: number | null = null, cached: number | null = null, reasoningTokens: number | null = null;
    let firstContentAt: number | null = null, thinkingStartedAt: number | null = null;
    const startedAt = Date.now();
    const tuning = currentTuning();
    const approvalMode = !!tuning.toolApproval;
    // Hoisted so paintNow() can see in-progress content during streaming
    let roundContent = '';
    let liveContentSegIdx: number | null = null;
    // Per-round stat trackers
    let roundReasoningTokens: number | null = null;
    let roundTps: number | null = null;
    let roundTpsFromMetrics = false;
    let roundOutput: number | null = null;
    let roundTokenCount: number | null = null;
    let roundFirstTokenAt: number | null = null;
    let roundStartTime = 0;
    let reasoningEndTs: number | null = null;

    // Mutable segments array — the "source of truth" for the thread timeline.
    // We mutate it in-place and publish IMMUTABLE SNAPSHOTS to the UI.
    const segments: ThreadSegment[] = [];

    // Uploaded attachments are resolved from memory; historical PDFs are
    // fetched once and cached by resolveChatFileDataUrl.

    // ── RAFT-backed painter ────────────────────────────────────────────────
    let paintPending = false;
    let paintCancelled = false;
    let paintFailures = 0;
        function schedulePaint() {
      if (paintPending || paintCancelled) return;
      paintPending = true;
      requestAnimationFrame(doPaint);
    }

    function doPaint() {
      paintPending = false;
      if (paintCancelled) return;
      paintNow();
    }

    /** Immutable snapshot of `segments` for the UI. Drops any reasoning
        segment that has produced no text yet — e.g. the eager placeholder
        left behind when reasoning mode is off. Publishing it would make an
        empty ".seg-reasoning" block flash in during streaming and vanish on
        close. Operates on a copy, so the live `segments` array (and its
        index bookkeeping) is untouched. */
    function takeSnapshot(src: ThreadSegment[]): ThreadSegment[] {
      return src
        .filter((s) => !(s.kind === 'reasoning' && !s.text))
        .map((s) => {
          switch (s.kind) {
            case 'reasoning': return { kind: 'reasoning' as const, text: s.text, stats: s.stats, startedAt: s.startedAt, contentStarted: s.contentStarted };
            case 'content': return { kind: 'content' as const, text: s.text };
            default: return {
              kind: 'tool' as const,
              serverId: s.serverId,
              toolName: s.toolName,
              arguments: s.arguments,
              result: s.result,
              isError: s.isError,
              rawArgs: s.rawArgs,
              toolCallId: s.toolCallId,
              approval: s.approval,
            };
          }
        });
    }

    /** Take an immutable snapshot of current state and push to UI. */
    function paintNow() {
      // Snapshot: deep-clone segments so the transcript's diff detects changes
      const snap: ThreadSegment[] = takeSnapshot(segments);

      amsg.threadSegments = snap;
      amsg.reasoning = reasoning;

      // Anti-duplicate: if content is already represented as a thread segment,
      // don't also render it in the markdown body.
      if (liveContentSegIdx !== null) {
        // Content lives in .thread — only show previously-committed rounds in .markdown
        if (full) amsg.parts = [{ type: 'text', text: full }];
        else amsg.parts = [];
      } else {
        const totalContent = full + roundContent;
        if (totalContent) amsg.parts = [{ type: 'text', text: totalContent }];
      }
      amsg.tps = tps; amsg.input = input; amsg.output = output;

      // Isolate the DOM-boundary call: a render exception must NEVER wedge the
      // painter (which would freeze the UI while the stream keeps being read)
      // nor leak into the agent loop. Contain it, log the stack, and if it
      // persists, surface a visible error instead of a silent dead screen.
      try {
        deps.updateLiveMessage(amsg);
        paintFailures = 0;
      } catch (err) {
        paintFailures++;
        console.error('[sharti][paint] updateLiveMessage threw — stream continues, paint degraded.', err);
        if (paintFailures === 1 || paintFailures % 30 === 0) {
          console.error('[sharti][paint] consecutive failures =', paintFailures, '| segments =', snap.map((s) => s.kind).join(','));
        }
        if (paintFailures >= STREAM.paintFailureLimit && !amsg.error) {
          amsg.error = 'Renderer hiccup — recovering\u2026';
          try { deps.updateLiveMessage(amsg); } catch { /* swallow secondary */ }
        }
      }
    }

    try {
      // A stale snapshot (reconnect, missed toggle broadcast) must not silently
      // drop native tools from the outgoing request.
      if (S.nativeToolsEnabled && S.nativeToolsInitialized && S.nativeToolDefs.length === 0) {
        await refreshNativeToolsState();
      }
      const wireTuning = currentTuning();
      let wireMessages = await buildInitialWireMessages(conv, {
        acceptsImages: acceptsImages(),
        systemPrompt: wireTuning.customSampling ? wireTuning.systemPrompt.trim() : '',
        resolveAttachment: (chatId, part) => resolveChatFileDataUrl(chatId, part, sessionDataUrls),
      });
      let toolRound = 0;

      // ── AGENT LOOP ──────────────────────────────────────────────────────
      while (true) {
        if (ctl.signal.aborted) break;

        const body = buildRequestBody(wireMessages);

        const opened = await openChatStream(conv.id, body, ctl.signal, tuning.timeout, tuning.maxRetries);
        const res = opened.res;
        if (!res.ok) {
          let em = `HTTP ${res.status}`;
          try { const j = await res.json(); em = friendlyError(j, conv); } catch { /* noop */ }
          opened.cleanup();
          throw new Error(em);
        }
        if (!res.body) {
          opened.cleanup();
          throw new Error('The provider returned an empty response body.');
        }

        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = '';
        let roundFinishReason: string | null = null;
        const accToolCalls = new Map<number, AccToolCall>();
        const toolSegIdx = new Map<number, number>();
        roundContent = '';
        roundReasoningTokens = null;
        roundTps = null;
        roundTpsFromMetrics = false;
        roundOutput = null;
        roundTokenCount = null;
        roundFirstTokenAt = null;
        roundStartTime = Date.now();
        reasoningEndTs = null;
        liveContentSegIdx = null;

        // ── OPEN a live reasoning segment for this round ─────────────────
        // It appears in `segments` immediately and grows as deltas arrive.
        const liveReasonSeg: { kind: 'reasoning'; text: string; stats?: string; startedAt?: number; contentStarted?: boolean } = { kind: 'reasoning', text: '' };
        segments.push(liveReasonSeg);
        const reasonSegIdx = segments.length - 1;

        /** Recompute reasoning-segment stats from whatever data is available now. */
        function refreshReasonStats() {
          if (!liveReasonSeg.text) return;
          const rStart = liveReasonSeg.startedAt || roundStartTime;
          const rEnd = reasoningEndTs || Date.now();
          const rDur = (rEnd - rStart) / 1000;
          const sp: string[] = [];
          if (roundReasoningTokens != null) sp.push(compactNum(roundReasoningTokens) + ' tokens');
          if (roundTps != null) sp.push(Math.round(roundTps) + ' tok/s');
          const ds = fmtDuration(rDur);
          if (ds) sp.push(ds);
          liveReasonSeg.stats = sp.join(' \u00b7 ') || undefined;
        }

        /** Fallback for providers that only report usage (no TPS metrics). */
        function computeRoundTpsIfNeeded(): void {
          if (roundTpsFromMetrics || roundOutput == null) return;
          let first = roundFirstTokenAt ?? roundStartTime;
          let seconds = (Date.now() - first) / 1000;
          // A provider that delivered everything in the final chunk gives a
          // near-zero generation window; fall back to the whole round.
          if (seconds <= 0.1) {
            first = roundStartTime;
            seconds = (Date.now() - first) / 1000;
          }
          if (seconds <= 0) return;
          roundTps = roundOutput / seconds;
          tps = roundTps;
          if (reasoningEndTs) { refreshReasonStats(); schedulePaint(); }
        }

        function appendReasoning(text: string): void {
          if (!text) return;
          if (roundFirstTokenAt == null) roundFirstTokenAt = Date.now();
          if (!liveReasonSeg.text) {
            if (thinkingStartedAt == null) thinkingStartedAt = Date.now();
            liveReasonSeg.startedAt = Date.now();
          }
          liveReasonSeg.text += text;
          reasoning += text;
          schedulePaint();
        }

        // ── READ STREAM ───────────────────────────────────────────────────
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            let idx: number;
            while ((idx = buf.indexOf('\n')) >= 0) {
              const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
              if (!line.startsWith('data:')) continue;
              const pl = line.slice(5).trim();
              if (pl === '[DONE]') continue;
              let ch: any; try { ch = JSON.parse(pl); } catch { continue; }
              if (ch.error) throw new Error(friendlyError(ch, conv));
              const choice = (ch.choices || [])[0];
              const d = choice && choice.delta;
              let deltaReasoning = '';
              if (d) {
                deltaReasoning = readReasoningDelta(d);
                if (deltaReasoning) appendReasoning(deltaReasoning);
                if (d.content) {
                  if (roundFirstTokenAt == null) roundFirstTokenAt = Date.now();
                  if (!roundContent && firstContentAt == null) firstContentAt = Date.now();
                  if (!liveReasonSeg.contentStarted) {
                    liveReasonSeg.contentStarted = true;
                    if (liveReasonSeg.text) {
                      reasoningEndTs = Date.now();
                      refreshReasonStats();
                    }
                  }
                  roundContent += d.content;

                  // If tool segments already exist, ensure content sits before them
                  if (liveContentSegIdx === null) {
                    let minToolIdx = Infinity;
                    for (const tIdx of toolSegIdx.values()) {
                      if (tIdx < minToolIdx) minToolIdx = tIdx;
                    }
                    if (minToolIdx !== Infinity) {
                      segments.splice(minToolIdx, 0, { kind: 'content', text: roundContent });
                      liveContentSegIdx = minToolIdx;
                      for (const [k, v] of toolSegIdx) {
                        if (v >= minToolIdx) toolSegIdx.set(k, v + 1);
                      }
                    }
                  } else {
                    (segments[liveContentSegIdx] as Extract<ThreadSegment, { kind: 'content' }>).text = roundContent;
                  }
                  schedulePaint();
                }
                if (d.tool_calls) {
                  for (const tc of d.tool_calls) {
                    const ti = tc.index ?? 0;
                    if (!accToolCalls.has(ti)) {
                      accToolCalls.set(ti, { id: tc.id || '', functionName: '', argumentsStr: '' });
                      // Reasoning hand-off: the moment the model moves on to a
                      // tool call, the reasoning phase has ended — regardless of
                      // whether prose also followed. Mark it (idempotently) so the
                      // duration is measured against the real reasoning end and the
                      // token/TPS enrichment below fires for tool-led rounds too,
                      // giving parity with the content path.
                      if (reasoningEndTs == null && liveReasonSeg.text) {
                        reasoningEndTs = Date.now();
                        refreshReasonStats();
                      }
                      // If content already accumulated but no segment yet — create it now
                      if (liveContentSegIdx === null && roundContent.trim()) {
                        segments.push({ kind: 'content', text: roundContent });
                        liveContentSegIdx = segments.length - 1;
                      }
                      // Push live tool segment for progressive display
                      segments.push({
                        kind: 'tool',
                        serverId: '',
                        toolName: '',
                        arguments: {},
                        result: '',
                        isError: false,
                        rawArgs: '',
                        toolCallId: tc.id || undefined,
                        approval: approvalMode ? 'streaming' : undefined,
                      });
                      toolSegIdx.set(ti, segments.length - 1);
                      schedulePaint();
                    }
                    const acc = accToolCalls.get(ti)!;
                    if (tc.id) {
                      acc.id = tc.id;
                      const segIdx = toolSegIdx.get(ti);
                      if (segIdx !== undefined) {
                        (segments[segIdx] as Extract<ThreadSegment, { kind: 'tool' }>).toolCallId = tc.id;
                      }
                    }
                    if (tc.function?.name) {
                      acc.functionName += tc.function.name;
                      const segIdx = toolSegIdx.get(ti);
                      if (segIdx !== undefined) {
                        const seg = segments[segIdx] as Extract<ThreadSegment, { kind: 'tool' }>;
                        seg.toolName = acc.functionName;
                        const sid = findServerForTool(acc.functionName);
                        if (sid) seg.serverId = sid;
                      }
                      schedulePaint();
                    }
                    if (tc.function?.arguments) {
                      acc.argumentsStr += tc.function.arguments;
                      const segIdx = toolSegIdx.get(ti);
                      if (segIdx !== undefined) {
                        (segments[segIdx] as Extract<ThreadSegment, { kind: 'tool' }>).rawArgs = acc.argumentsStr;
                      }
                      schedulePaint();
                    }
                  }
                }
              }
              // Some providers put reasoning on the chunk itself or only in the
              // final choice.message; both are accepted without double-appending.
              if (!deltaReasoning) {
                const typed = typeof ch.type === 'string' && /reason|think/i.test(ch.type)
                  ? reasoningText(ch.text ?? ch.content ?? ch.delta ?? ch)
                  : '';
                const chunkReasoning = readReasoningDelta(ch) || typed;
                if (chunkReasoning) appendReasoning(chunkReasoning);
              }
              if (!liveReasonSeg.text && choice?.message) {
                const messageReasoning = readReasoningDelta(choice.message);
                if (messageReasoning) appendReasoning(messageReasoning);
              }
              const chunkTps = readTokensPerSecond(ch);
              if (chunkTps != null) {
                tps = chunkTps;
                roundTps = chunkTps;
                roundTpsFromMetrics = true;
                // New TPS data — refresh reasoning stats if reasoning already ended
                if (reasoningEndTs) { refreshReasonStats(); schedulePaint(); }
              }
              const usage = readUsage(ch.usage);
              if (usage) {
                roundTokenCount = usage.total;
                if (usage.input != null) input = usage.input;
                if (usage.output != null) {
                  output = usage.output;
                  roundOutput = usage.output;
                }
                if (usage.cached != null) cached = usage.cached;
                if (usage.reasoning != null) {
                  reasoningTokens = usage.reasoning;
                  roundReasoningTokens = usage.reasoning;
                  // New token-count data — refresh reasoning stats if reasoning already ended
                  if (reasoningEndTs) { refreshReasonStats(); schedulePaint(); }
                }
              }
              computeRoundTpsIfNeeded();
              if (choice?.finish_reason) {
                roundFinishReason = choice.finish_reason;
                if (choice.finish_reason === 'length') amsg.error = "The reply reached the end of the model's context.";
              }
            }
          }
        } catch (e) {
          if (opened.timedOut() && !ctl.signal.aborted) {
            throw new Error(`Request timed out after ${tuning.timeout}s.`);
          }
          throw e;
        } finally {
          opened.cleanup();
        }

        // ── CLOSE ROUND ───────────────────────────────────────────────────
        // Final stats pass — ensures all data (tokens, TPS, duration) is captured.
        computeRoundTpsIfNeeded();
        refreshReasonStats();

        // If no reasoning came in, remove the empty segment
        if (liveReasonSeg.text === '') {
          segments.splice(reasonSegIdx, 1);
          if (liveContentSegIdx !== null && liveContentSegIdx > reasonSegIdx) liveContentSegIdx--;
          for (const [k, v] of toolSegIdx) {
            if (v > reasonSegIdx) toolSegIdx.set(k, v - 1);
          }
        }

        // Preserve round content for decisions below, then reset for next round
        const committedContent = roundContent;
        roundContent = '';

        // Force a paint to capture the final state of this round
        paintNow();

        // ── DECIDE: tool calls or done? ─────────────────────────────────
        if (tuning.toolChoice && roundFinishReason === 'tool_calls' && accToolCalls.size > 0) {
          toolRound++;
          if (toolRound > REQUEST.maxToolRounds) {
            throw new Error(`Tool loop exceeded ${REQUEST.maxToolRounds} rounds.`);
          }

          const toolCallsMsg = [...accToolCalls.values()].map((acc) => ({
            id: acc.id,
            type: 'function',
            function: { name: acc.functionName, arguments: acc.argumentsStr },
          }));
          const assistantToolMsg: Record<string, unknown> = {
            role: 'assistant',
            content: committedContent || null,
            tool_calls: toolCallsMsg,
          };

          // Finalize content segment (trim)
          if (liveContentSegIdx !== null) {
            (segments[liveContentSegIdx] as Extract<ThreadSegment, { kind: 'content' }>).text = committedContent.trim();
          }

          // Finalize tool segments: parse args, resolve serverId
          for (const [ti, acc] of accToolCalls) {
            const segIdx = toolSegIdx.get(ti);
            if (segIdx === undefined) continue;
            const seg = segments[segIdx] as Extract<ThreadSegment, { kind: 'tool' }>;
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(acc.argumentsStr || '{}'); } catch { /* empty */ }
            seg.arguments = args;
            seg.rawArgs = undefined;
            seg.toolName = acc.functionName;
            seg.toolCallId = acc.id;
            seg.serverId = findServerForTool(acc.functionName) ?? 'unknown';
            if (approvalMode && !seg.approval) seg.approval = 'streaming';
          }
          amsg.parts = [];
          paintNow();

          // Execute tools sequentially; each updates its segment
          const toolResultMsgs: Array<Record<string, unknown>> = [];
          for (const [ti, acc] of accToolCalls) {
            if (ctl.signal.aborted) break;
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(acc.argumentsStr || '{}'); } catch { /* empty */ }

            const segIdx = toolSegIdx.get(ti);
            const seg = segIdx !== undefined ? segments[segIdx] as Extract<ThreadSegment, { kind: 'tool' }> : null;

            if (approvalMode && seg) {
              const decision = await approval.request(seg, paintNow, ctl.signal);
              if (decision.rejected) {
                // Display a JSON result like every other tool call, while the
                // model receives the clean cancellation text.
                seg.result = JSON.stringify({ success: false, error: STREAM.cancelledToolMessage }, null, 2);
                seg.isError = false;
                toolResultMsgs.push({
                  role: 'tool',
                  tool_call_id: acc.id,
                  content: STREAM.cancelledToolMessage,
                });
                paintNow();
                continue;
              }
              if (decision.args) {
                args = decision.args;
                seg.arguments = args;
                // Keep the assistant tool_calls message in sync so the model
                // receives exactly the arguments the tool was executed with.
                const call = toolCallsMsg.find((c) => c.id === acc.id);
                if (call) call.function.arguments = JSON.stringify(args);
              }
            }

            const result = await executeMcpTool(acc.functionName, args);
            toolResultMsgs.push({
              role: 'tool',
              tool_call_id: acc.id,
              content: result.isError ? `[ERROR] ${result.text}` : result.text,
            });

            if (seg) {
              seg.result = result.json;
              seg.isError = result.isError;
            }
            paintNow();
          }

          wireMessages = [...wireMessages, assistantToolMsg, ...toolResultMsgs];
          continue;
        }

        // Normal finish — commit content to the final answer
        full += committedContent;
        // Yield one macrotask so the browser can paint the round-close state
        // (stats visible) before finalize flips live=false
        await new Promise(r => setTimeout(r, 0));
        break;
      }
      // ── END AGENT LOOP ──────────────────────────────────────────────────

      // Context occupancy comes from the real usage report of this turn's
      // final round: the prompt the model received plus the reply it produced
      // (both become part of the next prompt). Recompute it on every turn,
      // retries included — a retry replaces the reply with one of a different
      // length, so keeping the previous turn's number would go stale.
      if (roundTokenCount != null) {
        conv.tokenCount = roundTokenCount;
      }

      // Finalize
      const endedAt = Date.now();
      amsg.duration = (endedAt - startedAt) / 1000;
      if (tps == null && output != null) {
        const firstToken = thinkingStartedAt ?? firstContentAt;
        let seconds = firstToken ? (endedAt - firstToken) / 1000 : 0;
        if (seconds <= 0.1) seconds = (endedAt - startedAt) / 1000;
        if (seconds > 0) tps = output / seconds;
      }
      amsg.tps = tps; amsg.input = input; amsg.output = output; amsg.cached = cached; amsg.reasoningTokens = reasoningTokens;
      amsg.live = false;
      if (full) amsg.parts = [{ type: 'text', text: full }];
      amsg.threadSegments = takeSnapshot(segments);
      amsg.reasoning = reasoning;
      paintNow();
      await persistConversation(conv);
    } catch (e: any) {
      if (e.name === 'AbortError') { amsg.stopped = true; }
      else { amsg.error = e.message; }
      amsg.live = false;
      amsg.threadSegments = takeSnapshot(segments);
      amsg.reasoning = reasoning;
      if (full) amsg.parts = [{ type: 'text', text: full }];
      paintNow();
      await persistConversation(conv);
    } finally {
      paintCancelled = true; // kill any pending RAF
      S.streaming = null; S.streamAbort = null;
      bumpConversationOrder(conv);
      deps.renderChatSidebar();
      deps.renderComposer();
      deps.showPage();
    }
  }

  function friendlyError(obj: any, conv: Conversation): string {
    return formatChatError(obj, {
      external: isExternalApiActive(),
      serviceName: apiName(),
      contextLimit: contextLimit(),
      messageCount: conv.messages.length,
    }, contextFigure);
  }

  function stopStream(): void {
    if (S.streamAbort) S.streamAbort.abort();
  }

  async function retry(): Promise<void> {
    const conv = currentConv();
    if (!conv || S.streaming != null) return;
    const last = conv.messages[conv.messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    conv.messages.pop();
    const amsg = createAssistantMessage();
    conv.messages.push(amsg);
    S.streaming = conv.id;
    await persistConversation(conv);
    deps.renderChatSidebar();
    deps.renderConversation();
    deps.renderComposer();
    deps.showPage();
    deps.scrollToBottom();
    streamReply(conv, amsg, new Map());
  }

  return { sendMessage, stopStream, retry, persist: persistConversation, resolveToolApproval: approval.resolve };
}
