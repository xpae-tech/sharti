// Thread segment renderer: reasoning/content/tool blocks, their in-place
// streaming updates, and the shared timer ticker. The component owns its
// DOM-heavy internals so transcript/index.ts can focus on message diffing,
// editing, and scroll behavior.

import { UI_TIMING } from '../core/config.js';
import { type ThreadSegment } from '../types';
import { patch } from './patch.js';
import { prettyJson, renderMarkdown } from './markdown.js';
import { beginTranscriptEditAnchor, endTranscriptEditAnchor } from './edit-anchor.js';

type ToolSeg = Extract<ThreadSegment, { kind: 'tool' }>;
type ToolApprovalAction = 'continue' | 'reject' | 'correct';

// Extended HTMLElement with timer storage
type TimedEl = HTMLElement & { segStart?: number };

export interface SegmentBridge {
  onToolApproval?: (id: string, action: ToolApprovalAction, args?: Record<string, unknown>) => void;
}

export interface SegmentRenderer {
  buildReasoningSeg(seg: Extract<ThreadSegment, { kind: 'reasoning' }>, active: boolean, prevEl?: HTMLElement): HTMLElement;
  buildContentSeg(seg: Extract<ThreadSegment, { kind: 'content' }>): HTMLElement;
  buildToolSeg(seg: ToolSeg, live: boolean): HTMLElement;
  segmentMatches(el: HTMLElement, seg: ThreadSegment, prevSeg: ThreadSegment | undefined): boolean;
  updateSegmentInPlace(el: HTMLElement, seg: ThreadSegment, active: boolean, live: boolean): void;
  /** Stops the shared reasoning timer ticker. */
  destroy(): void;
}

const reasoningSegMarkup =
  '<div class="seg-reasoning">' +
  '<button type="button" class="seg-toggle hover">' +
  '<span class="glyph chevron"></span>' +
  '<span class="seg-verb"></span>' +
  '<span class="seg-facts"></span>' +
  '</button>' +
  '<div class="seg-thought"><div class="seg-fold"><div class="seg-text"></div><div class="seg-stats"></div></div></div>' +
  '</div>';

const toolSegMarkup =
  '<div class="seg-tool">' +
  '<div class="tool-block collapsed">' +
  '<button type="button" class="tb-toggle hover">' +
  '<span class="glyph wrench"></span>' +
  '<span class="tb-title"></span>' +
  '<span class="glyph chevron tb-chev"></span>' +
  '</button>' +
  '<div class="tb-body"><div class="tb-fold">' +
  '<div class="tb-section tb-args-section closed">' +
  '<button type="button" class="tb-sub-toggle hover"><span class="glyph chevron tb-sub-chev"></span><span class="tblabel">Arguments</span></button>' +
  '<div class="tb-sub-body"><div class="tb-sub-inner"><pre class="tb-pre tb-args-pre"></pre><div class="tb-args-wrap"><textarea class="tb-args-input" spellcheck="false" hidden></textarea></div></div></div>' +
  '</div>' +
  '<div class="tb-section tb-result-section closed">' +
  '<button type="button" class="tb-sub-toggle hover"><span class="glyph chevron tb-sub-chev"></span><span class="tblabel">Result</span></button>' +
  '<div class="tb-sub-body"><div class="tb-sub-inner"><pre class="tb-pre tb-result"></pre></div></div>' +
  '</div>' +
  '<div class="tb-approval" hidden>' +
  '<button type="button" class="btn sm tb-approve-reject">Reject</button>' +
  '<button type="button" class="btn sm prominent tb-approve-continue">Continue</button>' +
  '<button type="button" class="btn sm prominent tb-approve-correct">Continue with correction</button>' +
  '</div>' +
  '</div></div></div></div>';

/** Compute the display text for a tool segment's arguments section.
    Prefers rawArgs (streaming state) over the parsed object. */
export function computeArgsDisplay(seg: ToolSeg): string {
  if (seg.rawArgs) return seg.rawArgs;
  if (seg.arguments && Object.keys(seg.arguments).length > 0) return JSON.stringify(seg.arguments, null, 2);
  return '';
}

/** Parse the correction editor's JSON, returning null when it is not an object. */
export function parseToolArgsInput(raw: string): Record<string, unknown> | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim() || '{}'); } catch { return null; }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

const ARGS_MAX_HEIGHT = 420;

/** Fit the arguments editor to its content, scrolling only past the cap. */
export function autoSizeArgsInput(input: HTMLTextAreaElement, maxHeight = ARGS_MAX_HEIGHT): void {
  const style = getComputedStyle(input);
  const lineHeight = parseFloat(style.lineHeight) || 16;
  const paddingTop = parseFloat(style.paddingTop) || 0;
  const paddingBottom = parseFloat(style.paddingBottom) || 0;
  const borderTop = parseFloat(style.borderTopWidth) || 0;
  const borderBottom = parseFloat(style.borderBottomWidth) || 0;
  const verticalBorder = borderTop + borderBottom;
  const lines = input.value.split('\n').length;
  let contentHeight = lines * lineHeight + paddingTop + paddingBottom + verticalBorder;
  // A non-overlay horizontal scrollbar takes vertical room too. Measuring it
  // with overflow-y hidden keeps the field from reserving space for it.
  input.style.overflowY = 'hidden';
  if (input.scrollWidth > input.clientWidth) {
    contentHeight += Math.max(0, input.offsetHeight - input.clientHeight - verticalBorder);
  }
  input.style.height = `${Math.min(contentHeight, maxHeight)}px`;
  input.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
}

/** Toggle the `tb-disabled` class on each tb-section based on whether it
    currently holds visible content. Empty sections are non-interactive. */
function syncToolSectionAvail(toolSegEl: HTMLElement): void {
  const sections = toolSegEl.querySelectorAll('.tb-section');
  for (const section of sections) {
    const pre = section.querySelector('.tb-pre') as HTMLElement | null;
    const hasContent = !!(pre && (pre.textContent || '').length > 0);
    section.classList.toggle('tb-disabled', !hasContent);
  }
}

/** Reconcile the approval affordances with the segment's current state.
    Approval mode opens the block and the Arguments section; while a decision
    is pending the Result section is replaced by the action panel. */
function applyToolApprovalState(el: HTMLElement, seg: ToolSeg, live: boolean): void {
  const block = el.querySelector('.tool-block') as HTMLElement | null;
  if (!block) return;

  const approval = seg.approval;
  const awaiting = !!live && (approval === 'pending' || approval === 'correcting');
  const active = !!live && (approval === 'streaming' || awaiting);
  const correcting = awaiting && approval === 'correcting';
  const previous = block.dataset.approval ?? '';
  const wasActive = previous === 'streaming' || previous === 'pending' || previous === 'correcting';
  const enteringCorrection = correcting && previous !== 'correcting';
  const panel = block.querySelector('.tb-approval') as HTMLElement | null;
  const resultSection = block.querySelector('.tb-result-section') as HTMLElement | null;
  const argsSection = block.querySelector('.tb-args-section') as HTMLElement | null;
  const argsPre = block.querySelector('.tb-args-pre') as HTMLElement | null;
  const input = block.querySelector('.tb-args-input') as HTMLTextAreaElement | null;
  const correctBtn = block.querySelector('.tb-approve-correct') as HTMLButtonElement | null;

  if (panel) panel.hidden = !awaiting;
  // While approval mode streams or awaits a decision, the action panel owns
  // the Result slot — the standard Result section stays hidden.
  if (resultSection) resultSection.hidden = active;
  if (approval) block.dataset.approval = approval;
  else delete block.dataset.approval;

  if (active) {
    block.classList.remove('collapsed');
    argsSection?.classList.remove('closed');
  } else if (wasActive) {
    // A decision was just taken — fold the tool window back down.
    block.classList.add('collapsed');
    argsSection?.classList.add('closed');
  }

  if (correctBtn) correctBtn.disabled = correcting;
  if (argsPre) argsPre.hidden = correcting;
  if (correcting) argsSection?.classList.remove('tb-disabled');
  if (input) {
    input.hidden = !correcting;
    if (correcting) {
      if (!input.dataset.prefilled) {
        input.value = computeArgsDisplay(seg);
        input.dataset.prefilled = '1';
      }
      autoSizeArgsInput(input);
      if (enteringCorrection) {
        requestAnimationFrame(() => {
          if (!input.isConnected) return;
          autoSizeArgsInput(input);
          input.focus();
          input.setSelectionRange(0, 0);
        });
      }
    } else {
      delete input.dataset.prefilled;
      input.classList.remove('invalid');
    }
  }
}

export function createSegmentRenderer(
  bridge: SegmentBridge,
  getMessages: () => HTMLElement | null,
): SegmentRenderer {
  // ── Centralized timer ticker ─────────────────────────────────────────────
  // A single global interval updates all visible .seg-facts counters.
  // Much more robust than per-element setTimeout chains that die on rebuild.
  let segTicker: ReturnType<typeof setInterval> | null = null;

  function ensureSegTicker(): void {
    if (segTicker) return;
    segTicker = setInterval(tickSegFacts, UI_TIMING.thinkingTickMs);
  }

  function maybeStopSegTicker(): void {
    if (!segTicker) return;
    // Stop when no active segments remain
    if (!getMessages()?.querySelector('.seg-reasoning.thinking')) {
      clearInterval(segTicker);
      segTicker = null;
    }
  }

  function tickSegFacts(): void {
    const messages = getMessages();
    if (!messages) return;
    let anyActive = false;
    for (const el of messages.querySelectorAll('.seg-reasoning.thinking')) {
      anyActive = true;
      const timed = el as TimedEl;
      if (!timed.segStart) continue;
      const sec = Math.floor((Date.now() - timed.segStart) / 1000);
      const factsEl = el.querySelector('.seg-facts');
      if (factsEl) {
        const txt = sec < 1 ? '' : sec + 's';
        if (factsEl.textContent !== txt) factsEl.textContent = txt;
      }
    }
    if (!anyActive && segTicker) { clearInterval(segTicker); segTicker = null; }
  }

  /** Activate the timer on a segment element (sets start time, ensures ticker). */
  function armSegTimer(el: HTMLElement, startTime?: number): void {
    const timed = el as TimedEl;
    if (startTime) timed.segStart = startTime;
    else if (!timed.segStart) timed.segStart = Date.now();
    ensureSegTicker();
  }

  /** Deactivate the timer on a segment element. */
  function disarmSegTimer(el: HTMLElement): void {
    const timed = el as TimedEl;
    timed.segStart = undefined;
    const factsEl = el.querySelector('.seg-facts');
    if (factsEl) factsEl.textContent = '';
    maybeStopSegTicker();
  }

  function buildReasoningSeg(seg: Extract<ThreadSegment, { kind: 'reasoning' }>, active: boolean, prevEl?: HTMLElement): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = reasoningSegMarkup;
    const el = wrapper.firstElementChild as HTMLElement;
    const verb = el.querySelector('.seg-verb') as HTMLElement;
    const textDiv = el.querySelector('.seg-text') as HTMLElement;
    const statsDiv = el.querySelector('.seg-stats') as HTMLElement;
    const toggle = el.querySelector('.seg-toggle') as HTMLButtonElement;

    textDiv.textContent = seg.text;
    statsDiv.textContent = seg.stats || '';
    statsDiv.hidden = !seg.stats;

    if (active) {
      el.classList.add('thinking');
      verb.textContent = 'Thinking\u2026';
      // Inherit timer start from previous element if available, otherwise use seg.startedAt
      const prevTimed = prevEl ? (prevEl as TimedEl).segStart : undefined;
      armSegTimer(el, seg.startedAt || prevTimed);
    } else {
      verb.textContent = 'Thought';
    }

    toggle.onclick = (e) => {
      e.stopPropagation();
      el.classList.toggle('open');
    };

    return el;
  }

  function buildContentSeg(seg: Extract<ThreadSegment, { kind: 'content' }>): HTMLElement {
    const el = document.createElement('div');
    el.className = 'seg-content';
    patch(el, renderMarkdown(seg.text));
    return el;
  }

  function buildToolSeg(seg: ToolSeg, live: boolean): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = toolSegMarkup;
    const el = wrapper.firstElementChild as HTMLElement;
    const block = el.querySelector('.tool-block') as HTMLElement;
    block.dataset.toolCallId = seg.toolCallId ?? '';

    const title = block.querySelector('.tb-title') as HTMLElement;
    const serverSpan = document.createElement('span');
    serverSpan.className = 'tb-plugin';
    serverSpan.textContent = seg.serverId;
    const restSpan = document.createElement('span');
    restSpan.textContent = `: ${seg.toolName}`;
    title.replaceChildren(serverSpan, restSpan);
    if (seg.isError) block.classList.add('tb-error');

    const argsPre = block.querySelector('.tb-pre:not(.tb-result)');
    if (argsPre) argsPre.textContent = computeArgsDisplay(seg);

    const resultPre = block.querySelector('.tb-pre.tb-result');
    if (resultPre) resultPre.textContent = prettyJson(seg.result);

    syncToolSectionAvail(el);

    // Main toggle
    const mainToggle = block.querySelector('.tb-toggle') as HTMLButtonElement;
    mainToggle.onclick = (e) => {
      e.stopPropagation();
      block.classList.toggle('collapsed');
    };

    // Sub-toggles
    const subToggles = block.querySelectorAll('.tb-sub-toggle');
    subToggles.forEach((btn) => {
      (btn as HTMLButtonElement).onclick = (e) => {
        e.stopPropagation();
        const section = btn.parentElement;
        if (section) section.classList.toggle('closed');
      };
    });

    // Approval actions. The tool-call id is read from the DOM at click time so
    // in-place updates can fill it in after the first streaming chunk.
    const send = (action: ToolApprovalAction, args?: Record<string, unknown>): void => {
      const id = block.dataset.toolCallId || '';
      if (id && bridge.onToolApproval) bridge.onToolApproval(id, action, args);
    };

    const rejectBtn = block.querySelector('.tb-approve-reject') as HTMLButtonElement | null;
    if (rejectBtn) {
      rejectBtn.onclick = (e) => {
        e.stopPropagation();
        send('reject');
      };
    }

    const correctBtn = block.querySelector('.tb-approve-correct') as HTMLButtonElement | null;
    if (correctBtn) {
      correctBtn.onclick = (e) => {
        e.stopPropagation();
        if (correctBtn.disabled) return;
        send('correct');
      };
    }

    const input = block.querySelector('.tb-args-input') as HTMLTextAreaElement | null;
    if (input) {
      input.oninput = () => {
        input.classList.remove('invalid');
        autoSizeArgsInput(input);
      };
      input.addEventListener('focus', beginTranscriptEditAnchor);
      input.addEventListener('blur', endTranscriptEditAnchor);
    }

    const continueBtn = block.querySelector('.tb-approve-continue') as HTMLButtonElement | null;
    if (continueBtn) {
      continueBtn.onclick = (e) => {
        e.stopPropagation();
        if (block.dataset.approval !== 'correcting') {
          send('continue');
          return;
        }
        const field = block.querySelector('.tb-args-input') as HTMLTextAreaElement | null;
        const parsed = parseToolArgsInput(field?.value ?? '');
        if (!parsed) {
          field?.classList.add('invalid');
          field?.focus();
          return;
        }
        send('continue', parsed);
      };
    }

    applyToolApprovalState(el, seg, live);

    return el;
  }

  function segmentMatches(el: HTMLElement, seg: ThreadSegment, prevSeg: ThreadSegment | undefined): boolean {
    if (seg.kind === 'reasoning') {
      // Match if it's a reasoning seg AND either it hasn't changed or it's actively streaming
      const textEl = el.querySelector('.seg-text');
      const currentText = textEl ? (textEl.textContent || '') : '';
      if (currentText === seg.text) return true;
      // Allow in-place growth (prev text is prefix of new text)
      if (prevSeg && prevSeg.kind === 'reasoning' && seg.text.startsWith(prevSeg.text)) return true;
      return false;
    }
    if (seg.kind === 'content') {
      // Positional trust: type-class check confirmed it's .seg-content.
      // Actual update delegated to updateSegmentInPlace (patch + render).
      return true;
    }
    if (seg.kind === 'tool') {
      // Positional trust: type-class check already confirmed it's a .seg-tool
      // element at this slot. Title/content may evolve during streaming.
      return true;
    }
    return false;
  }

  function updateSegmentInPlace(el: HTMLElement, seg: ThreadSegment, active: boolean, live: boolean): void {
    if (seg.kind === 'reasoning') {
      const textEl = el.querySelector('.seg-text');
      if (textEl && textEl.textContent !== seg.text) {
        textEl.textContent = seg.text;
      }
      const statsEl = el.querySelector('.seg-stats');
      if (statsEl && statsEl.textContent !== (seg.stats || '')) {
        statsEl.textContent = seg.stats || '';
        (statsEl as HTMLElement).hidden = !seg.stats;
      }
      const verb = el.querySelector('.seg-verb');
      const wasActive = el.classList.contains('thinking');
      if (active) {
        el.classList.add('thinking');
        if (verb && verb.textContent !== 'Thinking\u2026') (verb as HTMLElement).textContent = 'Thinking\u2026';
        if (!wasActive) armSegTimer(el, seg.startedAt);
      } else {
        el.classList.remove('thinking');
        if (verb && verb.textContent !== 'Thought') (verb as HTMLElement).textContent = 'Thought';
        if (wasActive) disarmSegTimer(el);
      }
    } else if (seg.kind === 'content') {
      patch(el, renderMarkdown(seg.text));
    } else if (seg.kind === 'tool') {
      const block = el.querySelector('.tool-block') as HTMLElement | null;
      if (block) {
        block.dataset.toolCallId = seg.toolCallId ?? '';
        if (seg.isError) block.classList.add('tb-error');
        else block.classList.remove('tb-error');
      }
      // Update title (may change from "" → "real:name" during streaming)
      const titleEl = el.querySelector('.tb-title') as HTMLElement | null;
      if (titleEl) {
        const pluginSpan = titleEl.querySelector('.tb-plugin') as HTMLElement | null;
        const restSpan = titleEl.querySelector('span:not(.tb-plugin)') as HTMLElement | null;
        if (pluginSpan && pluginSpan.textContent !== seg.serverId) pluginSpan.textContent = seg.serverId;
        if (restSpan) {
          const expectedRest = `: ${seg.toolName}`;
          if (restSpan.textContent !== expectedRest) restSpan.textContent = expectedRest;
        }
      }
      // Update arguments (streams in progressively via rawArgs)
      const argsPre = el.querySelector('.tb-pre:not(.tb-result)') as HTMLElement | null;
      if (argsPre) {
        const newArgs = computeArgsDisplay(seg);
        if (argsPre.textContent !== newArgs) argsPre.textContent = newArgs;
      }
      // Update result when tool execution completes
      const resultPre = el.querySelector('.tb-pre.tb-result') as HTMLElement | null;
      if (resultPre) {
        const newText = prettyJson(seg.result);
        if (resultPre.textContent !== newText) resultPre.textContent = newText;
      }
      // Sync section interactivity (enable/disable based on content presence)
      syncToolSectionAvail(el);
      // Approval mode: keep expansion/buttons/editor in sync.
      applyToolApprovalState(el, seg, live);
    }
  }

  function destroy(): void {
    if (segTicker) { clearInterval(segTicker); segTicker = null; }
  }

  return { buildReasoningSeg, buildContentSeg, buildToolSeg, segmentMatches, updateSegmentInPlace, destroy };
}
