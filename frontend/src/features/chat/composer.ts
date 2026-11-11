// Composer: engine status display, effort selector, attachments, send state

import { el, esc, $ } from '../../core/dom.js';
import { S, serverAnswers, isStreamingHere, apiName, nameOf, ready, isExternalApiActive, currentTuning, acceptsImages } from '../../core/state.js';
import { sortEffortsForMenu } from '../../../../shared/reasoning.js';
import { effortTitle, resolveEffort } from '../../core/effort.js';
import { shortUrl } from '../../core/format.js';
import { openPopup } from '../../ui/popup.js';
import { connectionLabel, connectionTargets, openConnectionPicker, selectConnection } from '../../ui/connection-picker.js';
import { toast } from '../../core/feedback.js';
import { isSupportedAttachment } from '../attachments.js';
import { isPdfFile } from '../../types';
import type { Elements, ReasoningInfo } from '../../types';

interface ComposerDeps {
  stopStream: () => void;
  sendMessage: () => void;
  savePrefs: () => void;
  pickAttachments: () => void;
  addAttachmentFiles: (files: File[]) => void;
  openSettings: () => void;
  renderChatSidebar: () => void;
}

export function createComposer(E: Elements, deps: ComposerDeps) {
  function renderComposer(): void {
    const st = S.state;
    E.newChatBtn.disabled = !ready();

    // Disable all hover/click affordance when only 1 target is active (no-op zone)
    E.engineSlot.style.pointerEvents = connectionTargets().length === 1 ? 'none' : '';

    // External API mode
    if (isExternalApiActive()) {
      E.engineMark.dataset.look = 'on';
      E.engineText.innerHTML = esc(apiName());
      const active = S.externalApi.active;
      E.engineSlot.title = `Connected: ${apiName()} (${[active?.modelId, shortUrl(active?.baseUrl || '')].filter(Boolean).join(' \u00b7 ')})`;
      const caps = S.apiCaps;
      const eff = caps && caps.reasoning && caps.reasoning.thinks ? caps.reasoning : null;
      const samplingOn = currentTuning().customSampling;
      E.effortMenu.hidden = !eff || !samplingOn;
      if (eff) E.effortLabel.textContent = effortTitle(resolveEffort(eff, S.prefs.efforts['__api'] || ''));
      const attachmentsOk = caps ? caps.acceptsImages : true;
      E.attachPlus.hidden = !attachmentsOk;
      renderAttachments();
      updateSendState();
      return;
    }

    // Engine mode
    E.engineMark.dataset.look = st ? st.markLook! : 'off';
    let words = '';
    if (!st) words = 'No model running';
    else if (st.phase === 'ready') words = st.model ? nameOf(st.model) : '';
    else if (st.phase === 'starting' || st.phase === 'stopping') words = st.status!;
    else if (st.phase === 'failed') words = `${st.model ? nameOf(st.model) : ''} ran into a problem`;
    else words = S.models.length ? 'No model running' : 'No model on this Mac';
    const blocked = st && (st.phase === 'failed' || st.phase === 'stopped');
    E.engineText.innerHTML = esc(words) + (blocked ? ` <span class="open-link">Open Settings</span>` : '');
    E.engineSlot.title = 'Open Settings (\u23181)';

    const eff = st && st.phase === 'ready' && st.reasoning && st.reasoning.thinks ? st.reasoning : null;
    const samplingOn = currentTuning().customSampling;
    E.effortMenu.hidden = !eff || !samplingOn;
    if (eff) {
      const model = st?.model;
      E.effortLabel.textContent = effortTitle(resolveEffort(eff, model ? (S.prefs.efforts[model] || '') : ''));
    }

    const attachmentsOk = st && st.acceptsImages && st.phase === 'ready';
    E.attachPlus.hidden = !attachmentsOk;
    renderAttachments();
    updateSendState();
  }

  function renderAttachments(): void {
    const row = E.attachRow; row.innerHTML = '';
    S.draft.attachments.forEach((attachment, i) => {
      const remove = `<span class="rm" data-i="${i}">\u00d7</span>`;
      let tile: HTMLElement;
      if (isPdfFile(attachment.file)) {
        tile = el('div', 'thumb file');
        tile.title = attachment.file.name;
        tile.innerHTML = `<span class="file-ext">PDF</span><span class="file-name">${esc(attachment.file.name)}</span>${remove}`;
      } else {
        tile = el('div', 'thumb');
        tile.innerHTML = `<img src="${attachment.dataUrl}" alt="">${remove}`;
      }
      ($('.rm', tile) as HTMLElement).onclick = () => {
        S.draft.attachments.splice(i, 1);
        renderAttachments();
        updateSendState();
      };
      row.appendChild(tile);
    });
    row.hidden = S.draft.attachments.length === 0;
  }

  function updateSendState(): void {
    const here = isStreamingHere();
    const streamingAnywhere = S.streaming != null;
    const empty = S.draft.text.trim() === '' && S.draft.attachments.length === 0;
    const attachmentsOk = acceptsImages();
    const canSend = !here && !streamingAnywhere && serverAnswers() && !empty && (S.draft.attachments.length === 0 || attachmentsOk);
    E.sendBtn.disabled = !here && !canSend;
    E.sendBtn.classList.toggle('stopping', here);
    const composerCard = document.querySelector('.composer-card');
    if (composerCard) composerCard.classList.toggle('generating', here);
    const arrow = $('.arrow', E.sendBtn);
    if (arrow) arrow.innerHTML = here ? '&#9632;' : '&#8593;';
    E.sendBtn.title = here ? 'Stop (\u2318.)' : (serverAnswers() ? 'Send' : 'Available once a model is running');
    E.composerInput.disabled = !serverAnswers() && !here;
  }

  function autosize(): void {
    const ta = E.composerInput;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 220) + 'px';
  }

  function sendOrStop(): void {
    if (isStreamingHere()) { deps.stopStream(); return; }
    const empty = S.draft.text.trim() === '' && S.draft.attachments.length === 0;
    if (!serverAnswers() || S.streaming != null || empty) return;
    deps.sendMessage();
  }

  function applyDraftToDom(): void {
    E.composerInput.value = S.draft.text;
    autosize();
    renderAttachments();
    updateSendState();
  }

  // Effort helpers

  function currentEffort(eff: ReasoningInfo): string {
    const model = S.state && S.state.model;
    return resolveEffort(eff, model ? (S.prefs.efforts[model] || '') : '');
  }

  function currentEffortApi(eff: ReasoningInfo): string {
    return resolveEffort(eff, S.prefs.efforts['__api'] || '');
  }

  // Wire composer-specific events
  function wire(): void {
    E.sendBtn.onclick = sendOrStop;
    E.composerInput.addEventListener('input', () => { S.draft.text = E.composerInput.value; autosize(); updateSendState(); });
    E.composerInput.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendOrStop(); }
      else if (e.key === 'Escape' && isStreamingHere()) { e.preventDefault(); deps.stopStream(); }
    });
    E.attachPlus.onclick = () => deps.pickAttachments();

    // Paste + drop images and PDFs
    const canAcceptAttachments = (): boolean => acceptsImages();
    E.composerInput.addEventListener('paste', (e: ClipboardEvent) => {
      if (canAcceptAttachments()) {
        const files = [...(e.clipboardData!.items || [])]
          .filter((i) => i.kind === 'file')
          .map((i) => i.getAsFile())
          .filter((f): f is File => f !== null)
          .filter(isSupportedAttachment);
        if (files.length) { e.preventDefault(); deps.addAttachmentFiles(files); }
      }
    });
    E.composerInput.addEventListener('dragover', (e: DragEvent) => e.preventDefault());
    E.composerInput.addEventListener('drop', (e: DragEvent) => {
      if (canAcceptAttachments()) {
        const files = [...e.dataTransfer!.files].filter(isSupportedAttachment);
        if (files.length) { e.preventDefault(); deps.addAttachmentFiles(files); }
      }
    });

    // Engine slot click
    E.engineSlot.onclick = () => {
      const targets = connectionTargets();
      if (targets.length === 0) {
        deps.openSettings();
      } else if (targets.length === 1) {
        // Single active target — nothing to pick
        return;
      } else {
        openConnectionPicker(E.engineSlot, (target) => {
          selectConnection(target);
          deps.savePrefs();
          renderComposer();
          toast('Using ' + connectionLabel(target), E.toast);
        });
      }
    };

    // Effort menu
    E.effortMenu.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      const isInApiMode = isExternalApiActive();
      const eff = isInApiMode ? (S.apiCaps && S.apiCaps.reasoning) : (S.state && S.state.reasoning);
      if (!eff) return;
      const levels = eff.efforts.length > 0;
      const initial = isInApiMode ? currentEffortApi(eff) : currentEffort(eff);
      // No provider levels: offer only Default (omit the field) and No Thinking.
      // With provider levels, render exactly what the provider/engine returned
      // plus a Default reset only when the provider did not declare one.
      const choices = sortEffortsForMenu(levels
        ? eff.efforts.concat(eff.default == null && eff.thinks ? [''] : [], ['none'])
        : ['', 'none']);
      const items = choices.map((c) => ({ id: c, title: effortTitle(c), badge: c === initial ? 'Default' : '' }));
      openPopup(E.effortMenu, items, (id: string) => {
        const key = isInApiMode ? '__api' : (S.state!.model || '__api');
        // A model without advertised levels only has an on/off toggle; "on"
        // means "use the provider default", so no reasoning_effort is stored.
        const val = id;
        S.prefs.efforts = S.prefs.efforts || {};
        if (val) S.prefs.efforts[key] = val; else delete S.prefs.efforts[key];
        deps.savePrefs(); renderComposer();
      }, true);
    };

    // Search
    E.chatSearch.addEventListener('input', () => { S.searchQuery = E.chatSearch.value; deps.renderChatSidebar(); });
  }

  return { renderComposer, renderAttachments, updateSendState, autosize, sendOrStop, applyDraftToDom, wire };
}
