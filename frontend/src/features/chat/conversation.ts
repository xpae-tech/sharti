// Conversation view: transcript mounting, message transformation, empty state

import { el, $ } from '../../core/dom.js';
import { S, currentConv, apiName, nameOf, serverAnswers, isExternalApiActive } from '../../core/state.js';
import { compactNum, fmtDuration } from '../../core/format.js';
import { getMessageText, getMessageImages, getMessageFiles, getMessageReasoning, chatFileUrl } from '../../types';
import type { Elements, Conversation, ChatMessage, TranscriptPage, TranscriptMessage } from '../../types';

interface ConversationDeps {
  getTranscript: () => {
    mount: (root: HTMLElement) => void;
    show: (page: TranscriptPage) => void;
    update: (msg: TranscriptMessage) => void;
    jumpToBottom: () => void;
  };
}

export function createConversation(E: Elements, deps: ConversationDeps) {
  let transcriptModule: {
    mount: (root: HTMLElement) => void;
    show: (page: TranscriptPage) => void;
    update: (msg: TranscriptMessage) => void;
    jumpToBottom: () => void;
  } | null = null;

  function applyEmptyState(): void {
    const external = isExternalApiActive();
    const engineReady = !!S.state && S.state.phase === 'ready';
    E.emptyMark.dataset.look = external
      ? 'on'
      : (S.state && S.state.markLook === 'failed' ? 'off' : (S.state ? S.state.markLook! : 'off'));
    E.emptyHint.textContent = external || engineReady
      ? 'Start a conversation.'
      : (S.state ? S.state.status! : 'No model running.');
  }

  function renderConversation(): void {
    const conv = currentConv();
    const stage = E.convStage;

    // Lazily create the transcript host ONCE; never destroy it afterwards.
    let host = $('#transcriptHost', stage);
    if (!host) {
      host = el('div', 'transcript-host');
      host.id = 'transcriptHost';
      host.innerHTML = `<div class="transcript-doc"><main id="messages"></main></div>
        <button id="latest" aria-label="Back to latest"><span class="glyph down"></span></button>`;
      stage.appendChild(host);
      // Import transcript lazily to avoid circular deps
      transcriptModule = deps.getTranscript();
      transcriptModule.mount(host);
    }

    if (!conv || !conv.messages.length) {
      host.hidden = true;
      E.emptyState.hidden = false;
      applyEmptyState();
      return;
    }

    E.emptyState.hidden = true;
    host.hidden = false;
    showPage();
  }

  function renderConversationMarks(): void {
    const conv = currentConv();
    const isEmpty = !conv || !conv.messages.length;
    if (isEmpty) {
      const host = $('#transcriptHost', E.convStage);
      if (host) host.hidden = true;
      E.emptyState.hidden = false;
      applyEmptyState();
    } else {
      const host = $('#transcriptHost', E.convStage);
      if (host) { host.hidden = false; E.emptyState.hidden = true; }
    }
  }

  function showPage(): void {
    const conv = currentConv();
    if (!conv) return;
    if (!$('#transcriptHost', E.convStage)) return;
    transcriptModule!.show(buildPage(conv));
  }

  function updateLiveMessage(amsg: ChatMessage): void {
    if (!transcriptModule) return;
    transcriptModule.update(replyTM(amsg, !!amsg.live));
  }

  /** An assistant message is considered "pending" (invisible) until the
      server delivers at least one byte of content. Prevents reserving space
      for an empty response card before the stream starts. */
  function isPendingAssistant(m: ChatMessage): boolean {
    return m.role === 'assistant'
      && !getMessageText(m)
      && !getMessageReasoning(m)
      && !m.error
      && !m.stopped
      && !(m.threadSegments && m.threadSegments.length > 0);
  }

  function buildPage(conv: Conversation): TranscriptPage {
    const liveId = S.streaming === conv.id ? S.streaming : null;
    const msgs: TranscriptMessage[] = conv.messages
      .filter((m) => !isPendingAssistant(m))
      .map((m) => (m.role === 'user' ? userTM(m, conv.id) : replyTM(m, m.id === liveId)));
    const serviceName = isExternalApiActive() ? apiName() : (S.state && S.state.model ? nameOf(S.state.model) : 'the model');
    const askAgain = {
      enabled: serverAnswers() && S.streaming == null,
      help: `Ask ${serviceName} Again`,
    };
    return { id: conv.id, messages: msgs, askAgain };
  }

  function userTM(m: ChatMessage, chatId: string): TranscriptMessage {
    const text = getMessageText(m);
    const images = getMessageImages(m).map((ip) => chatFileUrl(chatId, ip.fileName));
    const files = getMessageFiles(m).map((fp) => ({
      url: chatFileUrl(chatId, fp.fileName),
      name: fp.originalName || fp.fileName,
    }));
    return { id: m.id, role: 'user', text, images, files };
  }

  function replyTM(m: ChatMessage, live: boolean): TranscriptMessage {
    const text = getMessageText(m);
    const details = composeDetails(m);

    // Migrate legacy: if no threadSegments but toolInvocations exist, synthesize
    let segments = m.threadSegments;
    if (!segments && m.toolInvocations && m.toolInvocations.length > 0) {
      segments = [];
      const reasoning = getMessageReasoning(m);
      if (reasoning) segments.push({ kind: 'reasoning', text: reasoning });
      for (const inv of m.toolInvocations) {
        segments.push({ kind: 'tool', serverId: inv.serverId, toolName: inv.toolName, arguments: inv.arguments, result: inv.result, isError: inv.isError });
      }
    }

    return {
      id: m.id, role: 'assistant', text, reasoning: getMessageReasoning(m),
      error: m.error || null, live: !!live, details,
      service: m.service || '', images: [],
      threadSegments: segments,
    };
  }

  function composeDetails(m: ChatMessage): string {
    const p: string[] = [];
    const renderTok = (m.output != null && m.reasoningTokens != null) ? m.output - m.reasoningTokens : m.output;
    if (renderTok != null) p.push(`${compactNum(renderTok)} tokens`);
    if (m.tps) p.push(`${m.tps.toFixed(0)} tok/s`);
    if (m.duration != null) p.push(fmtDuration(m.duration) || '');
    if (m.stopped) p.push('Stopped');
    return p.join(' \u00b7 ');
  }

  function scrollToBottom(): void {
    if (transcriptModule) transcriptModule.jumpToBottom();
  }

  return { renderConversation, renderConversationMarks, showPage, updateLiveMessage, scrollToBottom };
}
