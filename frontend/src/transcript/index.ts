// Transcript module: renders the conversation as formatted markdown messages.
// Self-contained component with its own internal state. Communicates outward
// exclusively through the bridge callbacks provided at mount time.

import type { TranscriptMessage, TranscriptPage, AskAgainInfo } from '../types';
import { UI_TIMING } from '../core/config.js';
import { copyGlyphs, renderMarkdown } from './markdown.js';
import { sameFiles, sameImages, sameMessage } from './diff.js';
import { patch } from './patch.js';
import { createSegmentRenderer } from './segments.js';
import { beginTranscriptEditAnchor, endTranscriptEditAnchor } from './edit-anchor.js';

type ToolApprovalAction = 'continue' | 'reject' | 'correct';
type TimedEl = HTMLElement & { copied?: ReturnType<typeof setTimeout> };

interface Bridge {
  onCopy?: (text: string) => void;
  onAskAgain?: () => void;
  onEdit?: (id: string, text: string) => void;
  onImageClick?: (src: string) => void;
  onToolApproval?: (id: string, action: ToolApprovalAction, args?: Record<string, unknown>) => void;
}

export function createTranscript(bridge: Bridge) {
  let messages: HTMLElement | null = null;
  let latest: HTMLButtonElement | null = null;
  let scroller: HTMLElement | null = null;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let mounted = false;

  function post(message: { copy?: string; askAgain?: boolean; edit?: { id: string; text: string } }): void {
    if (message.copy !== undefined) {
      const fn = bridge.onCopy || ((t: string) => { if (navigator.clipboard) navigator.clipboard.writeText(t); });
      try { fn(message.copy); } catch (e) { console.warn('[transcript] copy failed:', e); }
    }
    if (message.askAgain && bridge.onAskAgain) bridge.onAskAgain();
    if (message.edit && bridge.onEdit) bridge.onEdit(message.edit.id, message.edit.text);
  }

  // Segment builders use the live message container for the shared ticker.
  const renderer = createSegmentRenderer(bridge, () => messages);

  // MARK: Messages

  const views = new Map<string, { element: HTMLElement; message: TranscriptMessage | null }>();
  let conversation: string | null = null;
  let askAgain: AskAgainInfo = { enabled: false, help: '' };

  const userMarkup =
    '<div class="images"></div>' +
    '<div class="files"></div>' +
    '<div class="user-msg">' +
    '<p class="bubble"></p>' +
    '<div class="actions">' +
    '<button type="button" class="hover edit-user" title="Edit" aria-label="Edit Message"><span class="glyph edit"></span></button>' +
    '<button type="button" class="hover copy-user" title="Copy" aria-label="Copy Message">' + copyGlyphs + '</button>' +
    '</div>' +
    '</div>';

  const replyMarkup =
    '<div class="thread"></div>' +
    '<div class="markdown"></div>' +
    '<p class="error"><span class="glyph warning"></span><span class="message"></span></p>' +
    '<div class="actions">' +
    '<button type="button" class="hover edit-reply" title="Edit" aria-label="Edit Reply"><span class="glyph edit"></span></button>' +
    '<button type="button" class="hover copy-reply" title="Copy" aria-label="Copy Reply">' + copyGlyphs + '</button>' +
    '<button type="button" class="hover again" aria-label="Ask Again"><span class="glyph again"></span></button>' +
    '<span class="details"></span></div>';

  function draw(message: TranscriptMessage): HTMLElement {
    let view = views.get(message.id);
    if (!view) {
      const element = document.createElement('article');
      element.className = message.role === 'user' ? 'user' : 'reply';
      element.dataset.id = message.id;
      element.innerHTML = message.role === 'user' ? userMarkup : replyMarkup;
      view = { element, message: null };
      views.set(message.id, view);
    }
    if (!sameMessage(view.message, message)) {
      (message.role === 'user' ? drawUser : drawReply)(view.element, message, view.message);
      view.message = message;
    }
    return view.element;
  }

  function drawUser(element: HTMLElement, message: TranscriptMessage, previous: TranscriptMessage | null): void {
    const images = element.querySelector('.images') as HTMLElement;
    if (!previous || !sameImages(previous, message)) {
      images.replaceChildren(...message.images.map((url) => {
        const img = document.createElement('img');
        img.src = url;
        img.alt = '';
        img.className = 'zoomable';
        img.onclick = () => { if (bridge.onImageClick) bridge.onImageClick(url); };
        return img;
      }));
    }
    images.hidden = message.images.length === 0;
    const files = element.querySelector('.files') as HTMLElement;
    if (!previous || !sameFiles(previous, message)) {
      files.replaceChildren(...(message.files || []).map((file) => {
        const tile = document.createElement('a');
        tile.className = 'file-tile';
        tile.href = file.url;
        tile.target = '_blank';
        tile.rel = 'noopener';
        tile.title = file.name;
        tile.innerHTML = '<span class="file-ext">PDF</span><span class="file-name"></span>';
        (tile.querySelector('.file-name') as HTMLElement).textContent = file.name;
        return tile;
      }));
    }
    files.hidden = (message.files || []).length === 0;
    const bubble = element.querySelector('.bubble') as HTMLElement;
    bubble.textContent = message.text;
    bubble.hidden = message.text === '';
  }

  function drawReply(element: HTMLElement, message: TranscriptMessage, previous: TranscriptMessage | null): void {
    drawThread(element, message, previous);
    const body = element.querySelector('.markdown') as HTMLElement;
    if (message.text !== previous?.text) patch(body, renderMarkdown(message.text));
    body.hidden = message.text === '';
    const error = element.querySelector('.error') as HTMLElement;
    (error.querySelector('.message') as HTMLElement).textContent = message.error ?? '';
    error.hidden = message.error === null;
    element.classList.toggle('live', message.live!);
    // Errors count as a finished reply so the actions row (Ask Again) and details stay available.
    element.classList.toggle('answered', !!(!message.live && (message.text || message.reasoning || message.error)));
    // An errored reply keeps its actions row visible (see above) but editing and
    // copying are unavailable; retrying via Ask Again remains enabled.
    const editButton = element.querySelector('.edit-reply') as HTMLButtonElement;
    const copyButton = element.querySelector('.copy-reply') as HTMLButtonElement;
    editButton.disabled = !!message.error;
    copyButton.disabled = !!message.error;

    const det = element.querySelector('.details') as HTMLElement;
    det.replaceChildren();
    if (message.service) {
      const badge = document.createElement('span');
      badge.className = 'svc';
      badge.textContent = message.service;
      det.append(badge);
    }
    if (message.details) det.append(message.details);
    (element.querySelector('.actions') as HTMLElement).setAttribute('aria-hidden', String(message.live));
  }

  // MARK: Thread rendering (interleaved reasoning + tool segments)

  function drawThread(element: HTMLElement, message: TranscriptMessage, previous: TranscriptMessage | null): void {
    const container = element.querySelector('.thread') as HTMLElement;
    const segments = message.threadSegments || [];
    const prevSegments = previous?.threadSegments || [];

    // Fast path: no segments at all
    if (segments.length === 0) {
      // Waiting indicator only while we have produced nothing yet — neither a
      // reasoning/thought segment NOR any answer text. Once the answer starts
      // streaming into .markdown, drop the "Thinking…" spinner even if this
      // turn carried no reasoning segment.
      if (message.live && !message.text) {
        const fc = container.firstChild as Element | null;
        if (!fc || fc.getAttribute('data-role') !== 'wait') {
          container.innerHTML = '<div class="seg-wait" data-role="wait"><span class="seg-verb-wait">Thinking\u2026</span></div>';
        }
      } else {
        container.innerHTML = '';
      }
      return;
    }

    // Clear waiting indicator if present
    const waitEl = container.querySelector('[data-role="wait"]');
    if (waitEl) waitEl.remove();

    // Diff: reconcile segments
    const existing = [...container.children] as HTMLElement[];

    // Truncate extras
    while (container.children.length > segments.length) {
      container.removeChild(container.lastChild!);
    }

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const prevSeg = prevSegments[i];
      const existingEl = existing[i];

      // Check if existing element matches this segment type
      const typeClass = seg.kind === 'reasoning' ? 'seg-reasoning' : seg.kind === 'content' ? 'seg-content' : 'seg-tool';
      const hasCorrectType = existingEl?.classList.contains(typeClass);

      // "Active" = last segment, live, no stats yet (round not closed),
      // AND content has not started yet (stops animation when answer begins)
      const isActive = !!message.live && i === segments.length - 1 && (seg.kind !== 'reasoning' || !seg.stats) && !(seg.kind === 'reasoning' && seg.contentStarted);

      if (!hasCorrectType || !renderer.segmentMatches(existingEl, seg, prevSeg)) {
        // Rebuild this slot
        let newEl: HTMLElement;
        if (seg.kind === 'reasoning') newEl = renderer.buildReasoningSeg(seg, isActive, existingEl);
        else if (seg.kind === 'content') newEl = renderer.buildContentSeg(seg);
        else newEl = renderer.buildToolSeg(seg, !!message.live);
        if (existingEl) existingEl.replaceWith(newEl);
        else container.appendChild(newEl);
      } else {
        // In-place update (streaming: text growing)
        renderer.updateSegmentInPlace(existingEl!, seg, isActive, !!message.live);
      }
    }
  }

  function getLastArticle(): HTMLElement | null {
    if (!messages) return null;
    const children = messages.children;
    for (let i = children.length - 1; i >= 0; i--) {
      if (children[i].tagName === 'ARTICLE') return children[i] as HTMLElement;
    }
    return null;
  }

  function markLast(): void {
    if (!messages) return;
    for (const element of messages.querySelectorAll('.last')) element.classList.remove('last');
    const last = getLastArticle();
    last?.classList.add('last');
    const again = last?.querySelector('.again') as HTMLButtonElement | null;
    if (again) { again.disabled = !askAgain.enabled; again.title = askAgain.help; }
  }

  function show(page: TranscriptPage): void {
    const opened = page.id !== conversation;
    if (opened) { exitEditMode(false); views.clear(); renderer.destroy(); }
    const lastArt = getLastArticle();
    const added = !opened && page.messages[page.messages.length - 1]?.id !== lastArt?.dataset.id;
    conversation = page.id;
    askAgain = page.askAgain;
    const elements = page.messages.map(draw);
    const ids = new Set(page.messages.map((m) => m.id));
    for (const id of views.keys()) if (!ids.has(id)) views.delete(id);
    // Reconcile: only rewrite if the article sequence actually changed.
    const curArticles = Array.from(messages!.children).filter(c => c.tagName === 'ARTICLE') as HTMLElement[];
    const dirty = curArticles.length !== elements.length || elements.some((elm, i) => curArticles[i] !== elm);
    if (dirty) {
      messages!.replaceChildren(...elements);
      // Re-append sentinel (wiped by replaceChildren)
      if (sentinel) messages!.appendChild(sentinel);
    }
    markLast();
    if (opened || added) { stopGlide(); stickToBottom = true; hideButton(); scrollToBottomInstant(); }
  }

  function update(message: TranscriptMessage): void {
    const existed = views.has(message.id);
    const element = draw(message);
    if (!existed) {
      // Previously filtered out (pending/empty) — materialise the article now
      if (sentinel) messages!.insertBefore(element, sentinel);
      else messages!.appendChild(element);
      markLast();
    }
    onContentUpdated();
  }

  function onClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const button = target.closest('button') as HTMLButtonElement | null;
    if (!button) return;

    // Tool invocation block toggles are handled locally.
    // Suppress IO briefly so the CSS expand/collapse transition doesn't
    // falsely flip stickToBottom.
    if (button.classList.contains('tb-toggle') || button.classList.contains('tb-sub-toggle') || button.classList.contains('seg-toggle')) {
      return;
    }

    const article = button.closest('article') as HTMLElement | null;
    const view = article && views.get(article.dataset.id!);
    if (!view) return;
    if (button.classList.contains('copy-reply') || button.classList.contains('copy-user')) copy(button, view.message!.text);
    else if (button.classList.contains('copy-code')) copy(button, (button.closest('figure')!.querySelector('code') as HTMLElement).textContent!);
    else if (button.classList.contains('again')) post({ askAgain: true });
    else if (button.classList.contains('edit-user') || button.classList.contains('edit-reply')) enterEditMode(article!, view);
  }

  function copy(button: HTMLButtonElement, text: string): void {
    post({ copy: text });
    button.classList.add('copied');
    const btn = button as TimedEl;
    if (btn.copied) clearTimeout(btn.copied);
    btn.copied = setTimeout(() => button.classList.remove('copied'), UI_TIMING.copyFeedbackMs);
  }

  // MARK: Edit mode
  let editingArticle: HTMLElement | null = null;

  function enterEditMode(article: HTMLElement, view: { element: HTMLElement; message: TranscriptMessage | null }): void {
    exitEditMode(false);
    const msg = view.message!;
    const isUser = msg.role === 'user';
    const target = (isUser ? article.querySelector('.bubble') : article.querySelector('.markdown')) as HTMLElement;
    const origText = msg.text;

    const wrap = document.createElement('div');
    wrap.className = 'edit-wrap';
    wrap.style.width = `${target.offsetWidth}px`;
    const ta = document.createElement('textarea');
    ta.className = 'edit-area';
    ta.rows = 1;
    ta.value = origText;
    ta.spellcheck = false;
    wrap.appendChild(ta);
    const mirror = document.createElement('div');
    mirror.className = 'edit-mirror';
    mirror.setAttribute('aria-hidden', 'true');
    wrap.appendChild(mirror);

    const hint = document.createElement('div');
    hint.className = 'edit-hint';
    hint.textContent = 'Enter Save \u00b7 Shift+\u21b5 New line \u00b7 Esc Cancel';

    // A user bubble sizes to its text, so the editor must follow the typed
    // content up to the column width. The reply editor keeps the full width.
    const articleStyle = getComputedStyle(article);
    const availableWidth = article.clientWidth
      - parseFloat(articleStyle.paddingLeft)
      - parseFloat(articleStyle.paddingRight);
    const maxWidth = isUser ? Math.max(48, availableWidth) : target.offsetWidth;

    target.after(wrap, hint);
    target.hidden = true;
    article.classList.add('editing');
    editingArticle = article;

    const canvas = isUser ? document.createElement('canvas').getContext('2d') : null;
    const resize = () => {
      if (isUser && canvas) {
        const style = getComputedStyle(ta);
        canvas.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const horizontalPadding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        let textWidth = 0;
        for (const line of ta.value.split('\n')) {
          textWidth = Math.max(textWidth, canvas.measureText(line || ' ').width);
        }
        const width = Math.min(maxWidth, Math.max(48, Math.ceil(textWidth + horizontalPadding) + 1));
        wrap.style.width = `${width}px`;
      }
      const value = ta.value;
      mirror.textContent = value ? (value.endsWith('\n') ? `${value} ` : value) : ' ';
      ta.style.height = `${mirror.offsetHeight}px`;
    };
    ta.addEventListener('input', resize);
    resize();
    beginTranscriptEditAnchor();
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);

    const finish = (save: boolean) => {
      if (!article.isConnected) { cleanup(); return; }
      const val = ta.value;
      cleanup();
      if (save && val !== origText) {
        target.textContent = val;
        post({ edit: { id: msg.id, text: val } });
      }
      wrap.remove();
      hint.remove();
      target.hidden = false;
      article.classList.remove('editing');
      editingArticle = null;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    ta.addEventListener('keydown', onKeyDown);

    const onOutside = (e: MouseEvent) => { if (!(article as HTMLElement).contains(e.target as Node)) finish(true); }
    setTimeout(() => document.addEventListener('mousedown', onOutside), 0);

    const cleanup = () => {
      ta.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onOutside);
      endTranscriptEditAnchor();
    };
  }

  function exitEditMode(save: boolean): void {
    if (!editingArticle) return;
    const wrap = editingArticle.querySelector('.edit-wrap');
    if (wrap) {
      const ta = wrap.querySelector('.edit-area') as HTMLTextAreaElement;
      const val = ta ? ta.value : '';
      const msg = views.get(editingArticle.dataset.id!)?.message;
      if (save && msg && val !== msg.text) post({ edit: { id: msg.id, text: val } });
      wrap.remove();
      const hint = editingArticle.querySelector('.edit-hint');
      if (hint) hint.remove();
      const target = (editingArticle.querySelector('.bubble') || editingArticle.querySelector('.markdown')) as HTMLElement | null;
      if (target) (target as HTMLElement).hidden = false;
      editingArticle.classList.remove('editing');
      editingArticle = null;
    }
    endTranscriptEditAnchor();
  }

  // MARK: Scroll controller
  //
  // Design principles:
  //   1. Button visibility is derived from PHYSICAL STATE (isAtBottom ×
  //      scrollability), not from accumulated intent flags. Every user-input
  //      event (wheel, key, scroll) funnels through syncButton() which
  //      evaluates the scroller's current geometry and applies show/hide
  //      symmetrically.
  //   2. Non-scrollable containers (scrollHeight ≤ clientHeight) suppress
  //      the button unconditionally — there is nowhere to "go back to".
  //   3. IO tracks stickToBottom for auto-scroll gating. It also hides the
  //      button as a belt-and-braces confirmation, but deliberately does NOT
  //      show it (avoids phantom flashes from transient DOM layout shifts).
  //   4. Programmatic scrolls (auto-follow, jumpToBottom) are excluded from
  //      triggering user-intent detection via lastProgScroll / glideRaf guards.

  const BOTTOM_TOLERANCE = UI_TIMING.bottomTolerancePx;  // px from bottom = "at bottom"

  let stickToBottom = true;
  let io: IntersectionObserver | null = null;
  let ro: ResizeObserver | null = null;
  let roRaf = 0;  // debounce flag for ResizeObserver
  let sentinel: HTMLElement | null = null;
  let glideRaf: number | null = null;
  let lastProgScroll = 0;  // timestamp of last programmatic scrollTop write

  // ── Button visibility ────────────────────────────────────────────────────

  function showButton(): void {
    if (!latest) return;
    latest.classList.add('shown');
    latest.removeAttribute('aria-hidden');
    latest.tabIndex = 0;
  }

  function hideButton(): void {
    if (!latest) return;
    latest.classList.remove('shown');
    latest.setAttribute('aria-hidden', 'true');
    latest.tabIndex = -1;
  }

  // ── Scroll primitives ────────────────────────────────────────────────────

  function scrollToBottomInstant(): void {
    if (!scroller) return;
    lastProgScroll = performance.now();
    scroller.scrollTop = scroller.scrollHeight;
  }

  function scrollToBottomAnimated(): void {
    if (!scroller) return;
    stopGlide();
    if (reduced.matches) { scrollToBottomInstant(); return; }
    const start = scroller.scrollTop;
    const end = scroller.scrollHeight;
    const dist = end - start;
    if (dist < 1) return;
    const began = performance.now();
    const DURATION = UI_TIMING.scrollAnimationMs;
    const spring = (t: number) => 1 - (1 + 7.4 * t) * Math.exp(-7.4 * t);
    const step = (now: number) => {
      const t = Math.min((now - began) / DURATION, 1);
      scroller!.scrollTop = start + dist * spring(t) / spring(1);
      glideRaf = t < 1 ? requestAnimationFrame(step) : null;
    };
    glideRaf = requestAnimationFrame(step);
  }

  function stopGlide(): void {
    if (glideRaf !== null) { cancelAnimationFrame(glideRaf); glideRaf = null; }
  }

  function isAtBottom(): boolean {
    if (!scroller) return true;
    return (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop) <= BOTTOM_TOLERANCE;
  }

  // ── Unified button-state synchroniser ───────────────────────────────────
  // Single source of truth: derive visibility from the CURRENT physical
  // state of the scroller. Called by every user-input detector (wheel, key,
  // scroll) so behaviour is always symmetric (shows AND hides).

  function syncButton(): void {
    if (!scroller) return;
    // Container isn't taller than its viewport → nothing to scroll to → hide
    if (scroller.scrollHeight <= scroller.clientHeight) {
      hideButton();
      return;
    }
    if (isAtBottom()) hideButton();
    else showButton();
  }

  // ── User-intent detectors ────────────────────────────────────────────────

  const onWheel = (e: WheelEvent) => {
    if (e.deltaY < 0) syncButton();
  };

  const onKeyNav = (e: KeyboardEvent) => {
    if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home') syncButton();
  };

  const onScroll = () => {
    // Ignore if this was caused by our own programmatic scroll (< 100ms ago)
    if (performance.now() - lastProgScroll < UI_TIMING.programmaticScrollMs) return;
    // Ignore during glide animation
    if (glideRaf !== null) return;
    syncButton();
  };

  // ── IO: only HIDES the button (confirms we're at bottom) ────────────────

  function setupIO(): void {
    if (!scroller || !sentinel) return;
    io = new IntersectionObserver(([entry]) => {
      if (glideRaf !== null) return;
      if (entry.isIntersecting) {
        stickToBottom = true;
        hideButton();
      } else {
        stickToBottom = false;
        // Intentionally do NOT showButton() here — only input events do that.
        // This avoids phantom appearances from DOM manipulation artefacts.
      }
    }, {
      root: scroller,
      threshold: 0,
      rootMargin: `0px 0px ${BOTTOM_TOLERANCE}px 0px`,
    });
    io.observe(sentinel);
  }

  // ── ResizeObserver: react to content-height changes (expand/collapse) ────
  // Fires when any child mutates the intrinsic size of #messages (e.g. user
  // expands a reasoning/tool block). Debounced via rAF so we read stable
  // dimensions after the browser finishes the layout pass. Skipped when
  // auto-scroll is driving the layout (programmatic writes within 100 ms).

  function setupResizeSync(): void {
    if (!messages) return;
    ro = new ResizeObserver(() => {
      if (roRaf) return;
      roRaf = requestAnimationFrame(() => {
        roRaf = 0;
        if (performance.now() - lastProgScroll < UI_TIMING.programmaticScrollMs) return;
        if (glideRaf !== null) return;
        syncButton();
      });
    });
    ro.observe(messages!);
  }

  // ── Content growth hook ──────────────────────────────────────────────────

  function onContentUpdated(): void {
    if (stickToBottom && scroller) {
      scrollToBottomInstant();
    }
  }

  // ── External API ─────────────────────────────────────────────────────────

  function jumpToBottom(): void {
    stopGlide();
    stickToBottom = true;
    hideButton();
    scrollToBottomInstant();
  }

  function onLatestClick(): void {
    stickToBottom = true;
    hideButton();
    scrollToBottomAnimated();
  }

  // ── Wiring ───────────────────────────────────────────────────────────────

  function bindEvents(): void {
    sentinel = document.createElement('div');
    sentinel.dataset.sentinel = '';
    sentinel.style.cssText = 'height:0;width:0;flex:none;';
    messages!.appendChild(sentinel);

    setupIO();
    setupResizeSync();
    scroller!.addEventListener('wheel', onWheel, { passive: true });
    scroller!.addEventListener('keydown', onKeyNav, { passive: true });
    scroller!.addEventListener('scroll', onScroll, { passive: true });
    messages!.addEventListener('click', onClick);
    latest!.addEventListener('click', onLatestClick);
  }

  function destroy(): void {
    if (!mounted) return;
    stopGlide();
    if (io) { io.disconnect(); io = null; }
    if (ro) { ro.disconnect(); ro = null; }
    if (roRaf) { cancelAnimationFrame(roRaf); roRaf = 0; }
    if (sentinel) { sentinel.remove(); sentinel = null; }
    renderer.destroy();
    if (scroller) {
      scroller.removeEventListener('wheel', onWheel);
      scroller.removeEventListener('keydown', onKeyNav);
      scroller.removeEventListener('scroll', onScroll);
    }
    if (messages) messages.removeEventListener('click', onClick);
    if (latest) latest.removeEventListener('click', onLatestClick);
    views.clear();
    editingArticle = null;
    endTranscriptEditAnchor();
    mounted = false;
  }

  // MARK: Public API
  function mount(root: HTMLElement): void {
    if (mounted) return;
    messages = root.querySelector('#messages') as HTMLElement;
    latest = root.querySelector('#latest') as HTMLButtonElement;
    scroller = root;
    bindEvents();
    mounted = true;
  }

  return { mount, show, update, exitEditMode, destroy, jumpToBottom };
}
