// Splash Engine screen: welcome/problems, model list, download progress

import { el, esc, $ } from '../../core/dom.js';
import { cardHead, divider } from '../../ui/card.js';
import { S, applyModels, nameOf, prettyName, ready } from '../../core/state.js';
import { api } from '../../core/api.js';
import { downloadCaption, fmtSize } from '../../core/format.js';
import { openSheet, openConfirm } from '../../ui/sheet.js';
import { openPopup } from '../../ui/popup.js';
import { toast, copyText } from '../../core/feedback.js';
import { UI_TIMING } from '../../core/config.js';
import { renderBreadcrumb } from './method-cards.js';
import { renderLaunchOptions } from './launch-options.js';
import { emptyDownloadState } from '../../types';
import type { Elements, DiscoveredModel, CatalogEntry } from '../../types';
import { modelVariant } from '../../../../shared/model-id.js';
import { pickRecommendations } from './recommendations.js';

interface EngineScreenCallbacks {
  onRender: () => void;
  onStart: (model: string) => void;
  onDownload: (model: string) => void;
  onSavePrefs: () => void;
}

export function createEngineScreen(E: Elements, cb: EngineScreenCallbacks) {
  const { onRender, onStart, onDownload, onSavePrefs } = cb;

  function render(form: HTMLElement): void {
    renderBreadcrumb(form, 'Splash Engine', () => { S.serverView = 'method'; onRender(); });
    const st = S.state || { phase: 'stopped' as const };
    const first = S.models.length === 0;
    const failed = st.phase === 'failed';
    const installing = Boolean(S.download && S.download.running);
    const hasProblem = Boolean(S.blocker || failed || (S.download && S.download.failure));

    // Normal model-list view keeps the download progress card at the very top.
    if (!first && installing) {
      form.appendChild(downloadCard());
    }

    // Problems card — only when there is an actual issue.
    if (hasProblem) {
      form.appendChild(problemsCard());
    }

    // First run: the welcome header stays first, then progress/recommendations.
    if (first) {
      form.appendChild(el('div', 'srv-title', 'Welcome to Splash'));
      form.appendChild(el(
        'p',
        'srv-desc',
        'Splash runs AI models privately on this Mac. Download a model to get started.',
      ));
      if (installing) {
        form.appendChild(downloadCard());
      }
      const recommended = pickRecommendations(S.suggestions);
      if (recommended.length && !installing) {
        form.appendChild(recommendationCard(recommended));
      }
      if (!installing) form.appendChild(downloadCta());
    }

    // Models on this Mac
    if (!first) {
      const card = el('div', 'card');
      card.appendChild(cardHead('Models on This Mac'));
      S.models.forEach((m, i) => {
        card.appendChild(modelRow(m));
        if (i < S.models.length - 1) card.appendChild(divider());
      });
      const foot = el('div', 'card-foot');
      foot.style.display = 'flex'; foot.style.justifyContent = 'center'; foot.style.gap = '4px';
      foot.appendChild(linkBtn('Download Another Model', customModel, installing || !ready()));
      card.appendChild(foot);
      form.appendChild(card);
      form.appendChild(renderLaunchOptions({ onSavePrefs, onRender }));
    }
  }

  function problemsCard(): HTMLElement {
    const card = el('div', 'card');
    const hdr = el('div', 'card-head');
    hdr.appendChild(el('div', 'section-title', 'Attention'));
    const closeX = el('button', 'dismiss-card-x', '\u00d7');
    closeX.title = 'Dismiss';
    closeX.onclick = () => {
      S.download = emptyDownloadState();
      api('POST', '/api/dismiss-download').catch(() => { /* noop */ });
      onRender();
    };
    hdr.appendChild(closeX);
    card.appendChild(hdr);

    const body = el('div');
    if (S.blocker) body.appendChild(problemRow("Splash can't run here", S.blocker));
    const state = S.state;
    if (state && state.phase === 'failed' && state.model) {
      body.appendChild(problemRow(`${nameOf(state.model)} ran into a problem`, state.failMessage || 'Unknown error.'));
    }
    if (S.download && S.download.failure) {
      body.appendChild(problemRow(`${nameOf(S.download.failure.model)} couldn't download`, S.download.failure.message, [
        actionBtn('Retry', () => onDownload(S.download!.failure!.model)),
        actionBtn('\u00d7', () => {
          S.download = emptyDownloadState();
          onRender();
          api('POST', '/api/dismiss-download').catch(() => { /* noop */ });
        }, 'link-btn dismiss-btn'),
      ]));
    }
    card.appendChild(body);
    return card;
  }

  function downloadCta(): HTMLElement {
    // Primary action shown alongside the welcome/recommended blocks.
    const cta = el('div', 'cta-primary');
    cta.style.textAlign = 'center';
    cta.style.margin = '0 0 16px';
    const goBtn = el('button', 'btn prominent', 'Download another model') as HTMLButtonElement;
    goBtn.onclick = () => customModel();
    cta.appendChild(goBtn);
    return cta;
  }



  function recommendationCard(entries: CatalogEntry[]): HTMLElement {
    const card = el('div', 'card');
    card.appendChild(cardHead('Recommended'));
    entries.forEach((entry, index) => {
      card.appendChild(suggestionRow(entry));
      if (index < entries.length - 1) card.appendChild(divider());
    });
    return card;
  }

  function modelRow(m: DiscoveredModel): HTMLElement {
    const st = S.state;
    const isRunning = st && st.model === m.id && (st.phase === 'ready' || st.phase === 'starting' || st.phase === 'stopping');
    const isActive = st && st.model === m.id && st.phase === 'ready';
    const dotCls = isRunning ? 'conn-dot active' : 'conn-dot';
    const row = el('button', 'model-row' + (isActive ? ' selected' : ''));
    const detail = [prettyName(m.id), m.id !== prettyName(m.id) ? m.id : null, m.bytes != null ? fmtSize(m.bytes) : (m.missing ? 'Not found' : null)]
      .filter(Boolean).join(' \u00b7 ');
    row.innerHTML = `
      <span class="${dotCls}"></span>
      <span class="grow">
        <div class="model-name">${esc(nameOf(m.id))}</div>
        <div class="model-sub">${esc(detail)}</div>
      </span>
      <span class="model-phase">${esc(phaseTag(m.id))}</span>`;
    row.title = `Click to start \u00b7 ${((S.suggestions.find((v) => v.id === m.id)?.about) || m.id)}`;
    row.onclick = () => onStart(m.id);
    const dots = el('button', 'dots-btn', '\u00b7\u00b7\u00b7');
    dots.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      openPopup(dots, [
        { id: 'copy', title: 'Copy Model ID' },
        { id: 'finder', title: 'Show in Finder' },
        { id: 'delete', title: 'Delete' },
      ], (id: string) => {
        if (id === 'copy') { copyText(m.id); toast('Copied model ID', E.toast); }
        if (id === 'finder') api('POST', '/api/show-in-finder', { path: m.path || m.id, modelId: m.id }).then(() => { /* ok */ }).catch(() => toast('Cannot open Finder', E.toast));
        if (id === 'delete') confirmDeleteModel(m);
      }, true);
    };
    row.appendChild(dots);
    return row;
  }

  function confirmDeleteModel(m: DiscoveredModel): void {
    const label = nameOf(m.id);
    openConfirm(
      E.sheetBackdrop,
      `Delete "${esc(label)}"?`,
      'The model files will be removed from this Mac.',
      () => {
        api('POST', '/api/models/delete', { modelId: m.id }).then((res) => {
          if (res?.models) applyModels(res.models);
          onRender();
          toast(`Deleted ${label}`, E.toast);
        }).catch((e: any) => toast(e.message || 'Could not delete model', E.toast));
      },
    );
  }

  function downloadCard(): HTMLElement {
    const dl = S.download!;
    const card = el('div', 'card');
    const row = el('div', 'row');
    row.style.justifyContent = 'space-between';
    const grow = el('div', 'grow');
    grow.innerHTML = `<div class="model-name">Downloading ${esc(nameOf(dl.model!))}</div>
      <div class="model-sub">${esc(downloadCaption(dl))}</div>`;
    const btn = el('button', 'btn sm', 'Cancel') as HTMLButtonElement;
    btn.onclick = () => {
      S.download = emptyDownloadState(dl.model);
      onRender();
      api('DELETE', '/api/download').catch(() => { /* handled via SSE */ });
    };
    row.appendChild(grow);
    row.appendChild(btn);
    card.appendChild(row);

    const trackWrap = el('div', 'progress-wrap');
    const pct = dl.progress ? Math.round(dl.progress.fraction * 100) : 0;
    const track = el('div', 'progress-track' + (dl.progress ? '' : ' indeterminate'));
    track.setAttribute('data-progress-track', '');
    track.innerHTML = `<div class="progress-fill" data-progress-fill style="width:${pct}%"></div>`;
    trackWrap.appendChild(track);
    card.appendChild(trackWrap);

    // Tag the caption for in-place updates
    const sub = grow.querySelector('.model-sub');
    if (sub) sub.setAttribute('data-dl-caption', '');

    return card;
  }



  function customModel(): void {
    openSheet(E.sheetBackdrop,
      `<div class="sheet-head">Download Another Model</div>
      <div class="sheet-body"><input class="big" id="cmInput" placeholder="owner/model or owner/model:variant" spellcheck="false"></div>
      <div class="sheet-foot-note">Any Hugging Face model Splash runs, such as unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M.</div>`,
      [`<button class="btn" data-role="cancel">Cancel</button>`, `<button class="btn prominent" data-role="go" disabled>Download</button>`],
      (root: HTMLElement, close: () => void) => {
        const inp = $('#cmInput', E.sheetBackdrop) as HTMLInputElement;
        const go = $('[data-role="go"]', root) as HTMLButtonElement;
        const valid = () => /^[\w.-]+\/[\w.-]+(:[\w.-]+)?$/.test(inp.value.trim());
        inp.oninput = () => (go.disabled = !valid());
        inp.onkeydown = (e: KeyboardEvent) => { if (e.key === 'Enter' && valid()) { onDownload(inp.value.trim()); close(); } };
        go.onclick = () => { if (valid()) { onDownload(inp.value.trim()); close(); } };
        setTimeout(() => inp.focus(), UI_TIMING.focusDelayMs);
      });
  }

  function suggestionRow(s: { id: string; name?: string; about?: string; size?: number }): HTMLElement {
    const variant = modelVariant(s.id);
    const name = s.name || prettyName(s.id);
    const label = variant ? `${name} (${variant})` : name;
    const sub = [s.about, s.size != null ? fmtSize(Math.round(s.size * 1024 * 1024 * 1024)) : null]
      .filter(Boolean).join(' \u00b7 ');
    const row = el('div', 'row');
    const grow = el('div', 'grow');
    grow.innerHTML = `<div class="model-name">${esc(label)}</div><div class="model-sub">${esc(sub)}</div>`;
    row.appendChild(grow);
    const btn = el('button', 'btn sm', 'Download') as HTMLButtonElement;
    btn.onclick = () => onDownload(s.id);
    row.appendChild(btn);
    return row;
  }



  return { render };
}

// Phase indicator for a model row
export function phaseTag(id: string): string {
  const st = S.state;
  if (!st) return '';
  if (st.next === id && st.model !== id) return 'Up next';
  if (st.phase !== 'ready' && st.phase !== 'starting' && st.phase !== 'stopping' && st.phase !== 'failed') return '';
  if (st.model !== id) return '';
  switch (st.phase) {
    case 'ready': return st.serving === 'sleeping' ? 'Sleeping' : st.serving === 'recovering' ? 'Recovering' : 'Running';
    case 'starting': return `${st.step}\u2026`;
    case 'stopping': return st.next === id ? 'Restarting\u2026' : 'Stopping\u2026';
    case 'failed': return 'Not responding';
    default: return '';
  }
}

// Shared UI helpers
function linkBtn(label: string, fn: () => void, disabled?: boolean): HTMLButtonElement { const b = el('button', 'link-btn', esc(label)) as HTMLButtonElement; b.onclick = fn; if (disabled) b.disabled = true; return b; }
function actionBtn(label: string, fn: () => void, cls?: string): HTMLElement { const b = el('button', cls || 'btn', esc(label)); b.onclick = fn; return b; }
function problemRow(title: string, message: string, actions?: HTMLElement[]): HTMLElement {
  const row = el('div', 'problem');
  row.innerHTML = `<span class="conn-dot danger"></span><div class="grow"><h3>${esc(title)}</h3><p>${esc(message)}</p></div>`;
  const acts = el('div', 'acts');
  (actions || []).forEach((a) => acts.appendChild(a));
  if (acts.childNodes.length) row.appendChild(acts);
  return row;
}
