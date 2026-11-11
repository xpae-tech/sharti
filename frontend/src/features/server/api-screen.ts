// External API connections screen: list, add, edit, delete

import { el, esc, $ } from '../../core/dom.js';
import { cardHead, divider } from '../../ui/card.js';
import { S } from '../../core/state.js';
import { api, savePrefs } from '../../core/api.js';
import { openSheet, openConfirm } from '../../ui/sheet.js';
import { openPopup } from '../../ui/popup.js';
import { preferExternalConnection } from '../../ui/connection-picker.js';
import { toast } from '../../core/feedback.js';
import { UI_TIMING } from '../../core/config.js';
import { renderBreadcrumb } from './method-cards.js';
import type { Elements, ApiConnection } from '../../types';

interface ApiScreenCallbacks {
  onRender: () => void;
  onRefreshCaps: () => void;
  onBeginMutation: () => () => void;
}

export function createApiScreen(E: Elements, cb: ApiScreenCallbacks) {
  const { onRender, onRefreshCaps, onBeginMutation } = cb;

  function clearDrafts(): void {
    S.apiUrlDraft = '';
    S.apiNameDraft = '';
    S.apiKeyDraft = '';
    S.apiModelNameDraft = '';
    S.apiModelIdDraft = '';
  }

  function render(form: HTMLElement): void {
    renderBreadcrumb(form, 'External API', () => { S.serverView = 'method'; onRender(); });

    // Saved connections list
    const conns = S.externalApi.connections || [];
    if (conns.length) {
      const card = el('div', 'card');
      card.appendChild(cardHead('Saved Connections'));
      conns.forEach((c, i) => {
        const isActive = c.id === S.externalApi.activeId;
        const row = el('button', 'model-row' + (isActive ? ' selected' : ''));
        const dotCls = isActive ? 'conn-dot active' : 'conn-dot';
        const title = c.modelName || c.name || c.modelId || 'External API';
        const sub = [
          c.modelName && c.name && c.name !== c.modelName ? c.name : '',
          c.baseUrl,
          c.modelId,
        ].filter(Boolean).join(' \u00b7 ');
        row.innerHTML = `<span class="${dotCls}"></span>
          <span class="grow">
            <div class="model-name">${esc(title)}</div>
            <div class="model-sub">${esc(sub)}</div>
          </span>
          ${isActive ? '<span class="model-phase">Active</span>' : ''}`;
        row.title = c.baseUrl;
        row.onclick = () => activateConn(c.id);
        const adots = el('button', 'dots-btn', '···');
        adots.onclick = (e: MouseEvent) => {
          e.stopPropagation();
          openPopup(adots, [
            { id: 'edit', title: 'Edit' },
            { id: 'del', title: 'Delete' },
          ], (id: string) => {
            if (id === 'edit') editConn(c);
            if (id === 'del') confirmDel(c);
          }, true);
        };
        row.appendChild(adots);
        card.appendChild(row);
        if (i < conns.length - 1) card.appendChild(divider());
      });
      form.appendChild(card);
    }

    // Add / new connection form
    const card2 = el('div', 'card');
    card2.appendChild(cardHead(S.externalApi.connected ? 'Add New Connection' : 'New Connection'));
    const body = el('div', 'api-form');

    const nameInp = el('input', 'field api-name') as HTMLInputElement;
    nameInp.type = 'text'; nameInp.placeholder = 'My Ollama, Work API\u2026'; nameInp.spellcheck = false;
    nameInp.value = S.externalApi.connected ? '' : S.apiNameDraft;

    const inp = el('input', 'field api-url') as HTMLInputElement;
    inp.type = 'text'; inp.placeholder = 'http://your-server:port/v1'; inp.spellcheck = false;
    inp.value = S.externalApi.connected ? '' : S.apiUrlDraft;

    const keyInp = el('input', 'field api-url') as HTMLInputElement;
    keyInp.type = 'password'; keyInp.placeholder = 'sh-\u2026'; keyInp.autocomplete = 'off'; keyInp.spellcheck = false;
    keyInp.value = S.externalApi.connected ? '' : S.apiKeyDraft;

    const modelNameInp = el('input', 'field api-name') as HTMLInputElement;
    modelNameInp.type = 'text'; modelNameInp.placeholder = 'GPT-4o'; modelNameInp.spellcheck = false;
    modelNameInp.value = S.externalApi.connected ? '' : S.apiModelNameDraft;

    const modelIdInp = el('input', 'field api-url') as HTMLInputElement;
    modelIdInp.type = 'text'; modelIdInp.placeholder = 'gpt-4o'; modelIdInp.spellcheck = false;
    modelIdInp.value = S.externalApi.connected ? '' : S.apiModelIdDraft;

    const btnRow = el('div', 'api-btns');
    const connBtn = el('button', 'btn prominent', 'Connect') as HTMLButtonElement;
    const busy = el('span', 'api-busy', '');
    const fields = [
      apiField('Name', nameInp, 'A label to identify this connection.'),
      apiField('Base URL', inp, 'OpenAI-compatible base URL, e.g. http://localhost:11434 or https://api.example.com/v1'),
      apiField('API Key', keyInp, 'Optional bearer token for the external API.'),
      apiField('Model Name', modelNameInp, 'Display name shown in the app, e.g. GPT-4o.'),
      apiField('Model ID', modelIdInp, 'Model identifier sent to the API, e.g. gpt-4o. Empty uses the first model from /v1/models.'),
    ];
    fields.forEach((field, index) => {
      body.appendChild(field);
      if (index < fields.length - 1) body.appendChild(divider());
    });
    body.appendChild(divider());
    body.appendChild(btnRow);
    btnRow.appendChild(connBtn); btnRow.appendChild(busy);
    card2.appendChild(body);
    form.appendChild(card2);

    connBtn.onclick = async () => {
      const url = inp.value.trim();
      if (!url) { busy.textContent = 'Enter a URL'; return; }
      connBtn.disabled = true; busy.textContent = 'Checking connection\u2026';
      const release = onBeginMutation();
      try {
        const res = await fetch('/api/api-connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            name: nameInp.value.trim(),
            apiKey: keyInp.value.trim(),
            modelName: modelNameInp.value.trim(),
            modelId: modelIdInp.value.trim(),
          }),
        });
        const data: any = await res.json().catch(() => ({}));
        if (res.status === 409 && data.existing) {
          showDupDialog(data.existing);
          busy.textContent = '';
          connBtn.disabled = false;
          return;
        }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const status = await api('GET', '/api/api-status');
        S.externalApi = status;
        clearDrafts();
        // Unlock: connecting an external API implicitly prefers it over a dead engine
        if (preferExternalConnection()) savePrefs();
        onRefreshCaps();
        onRender();
      } catch (e: any) {
        busy.textContent = e.message;
      } finally {
        release();
        if (busy.textContent) connBtn.disabled = false;
      }
    };
    inp.onkeydown = (e: KeyboardEvent) => { if (e.key === 'Enter') connBtn.click(); };
  }

  async function activateConn(id: string): Promise<void> {
    const release = onBeginMutation();
    try {
      await api('POST', `/api/api-activate/${encodeURIComponent(id)}`);
      const status = await api('GET', '/api/api-status');
      S.externalApi = status;
      clearDrafts();
      // Unlock: activating an external API implicitly prefers it over a dead engine
      if (preferExternalConnection()) savePrefs();
      onRefreshCaps();
      onRender();
    } catch (e: any) { toast(e.message, E.toast); }
    finally { release(); }
  }

  function editConn(conn: ApiConnection): void {
    const keyPlaceholder = conn.hasApiKey ? 'Stored key — leave empty to keep' : 'Optional bearer token';
    openSheet(E.sheetBackdrop,
      `<div class="sheet-head">Edit Connection</div>
       <div class="sheet-body">
         <div class="api-form api-form-sheet" style="padding:0;">
           <div class="api-field"><label class="api-label">Name</label><input class="field api-name" id="__editName" value="${esc(conn.name)}" spellcheck="false"></div>
           <div class="api-field"><label class="api-label">Base URL</label><input class="field api-url" id="__editUrl" value="${esc(conn.baseUrl)}" spellcheck="false"></div>
           <div class="api-field"><label class="api-label">API Key</label><input class="field api-url" id="__editKey" type="password" autocomplete="off" placeholder="${keyPlaceholder}" spellcheck="false">${conn.hasApiKey ? '<label class="api-clear-key"><input type="checkbox" id="__editClearKey"> Clear stored API key</label>' : ''}</div>
           <div class="api-field"><label class="api-label">Model Name</label><input class="field api-name" id="__editModelName" value="${esc(conn.modelName)}" spellcheck="false"></div>
           <div class="api-field"><label class="api-label">Model ID</label><input class="field api-url" id="__editModelId" value="${esc(conn.modelId)}" spellcheck="false"></div>
         </div>
       </div>`,
      [`<button class="btn" data-role="cancel">Cancel</button>`, `<button class="btn prominent" data-role="go">Save</button>`],
      (root: HTMLElement, close: () => void) => {
        const nameInp = $('#__editName', E.sheetBackdrop) as HTMLInputElement;
        const urlInp = $('#__editUrl', E.sheetBackdrop) as HTMLInputElement;
        const keyInp = $('#__editKey', E.sheetBackdrop) as HTMLInputElement;
        const modelNameInp = $('#__editModelName', E.sheetBackdrop) as HTMLInputElement;
        const modelIdInp = $('#__editModelId', E.sheetBackdrop) as HTMLInputElement;
        const clearKeyInp = $('#__editClearKey', E.sheetBackdrop) as HTMLInputElement | null;
        const clearKeyLabel = clearKeyInp?.closest('.api-clear-key') as HTMLLabelElement | null;
        const syncClearKey = (): void => {
          if (!clearKeyInp) return;
          const hasNewKey = keyInp.value.trim().length > 0;
          clearKeyInp.disabled = hasNewKey;
          if (hasNewKey) clearKeyInp.checked = false;
          clearKeyLabel?.classList.toggle('disabled', hasNewKey);
        };
        keyInp.addEventListener('input', syncClearKey);
        syncClearKey();
        const go = async () => {
          const release = onBeginMutation();
          try {
            await api('PUT', `/api/api-connections/${encodeURIComponent(conn.id)}`, {
              name: nameInp.value.trim(),
              baseUrl: urlInp.value.trim(),
              apiKey: keyInp.value.trim(),
              clearApiKey: clearKeyInp?.checked === true,
              modelName: modelNameInp.value.trim(),
              modelId: modelIdInp.value.trim(),
            });
            const status = await api('GET', '/api/api-status');
            S.externalApi = status;
            onRefreshCaps();
            onRender();
            close();
          } catch (e: any) { toast(e.message, E.toast); }
          finally { release(); }
        };
        ($('[data-role="go"]', root) as HTMLButtonElement).onclick = go;
        [nameInp, urlInp, keyInp, modelNameInp, modelIdInp].forEach((inp) => {
          inp.onkeydown = (e: KeyboardEvent) => { if (e.key === 'Enter') go(); };
        });
        setTimeout(() => nameInp.focus(), UI_TIMING.focusDelayMs);
      });
  }

  function confirmDel(conn: ApiConnection): void {
    const label = conn.modelName || conn.name || conn.baseUrl;
    openConfirm(E.sheetBackdrop, `Delete "${esc(label)}"?`, 'The connection will be removed from this Mac.', () => del(conn.id));
  }

  async function del(id: string): Promise<void> {
    const release = onBeginMutation();
    try {
      await api('DELETE', `/api/api-connections/${encodeURIComponent(id)}`);
      const status = await api('GET', '/api/api-status');
      S.externalApi = status;
      onRefreshCaps();
      onRender();
    } catch (e: any) { toast(e.message, E.toast); }
    finally { release(); }
  }

  function showDupDialog(existing: ApiConnection): void {
    const label = existing.name ? `"${esc(existing.name)}"` : 'with this URL';
    openSheet(E.sheetBackdrop,
      `<div class="sheet-head">Connection Already Exists</div>
       <div class="sheet-body">
         <p>A connection ${label} pointing to<br><strong>${esc(existing.baseUrl)}</strong> is already saved.</p>
         <p class="dup-hint">Would you like to use the existing connection?</p>
       </div>`,
      [`<button class="btn" data-role="cancel">Close</button>`, `<button class="btn prominent" data-role="use-existing">Use Existing</button>`],
      (root: HTMLElement, close: () => void) => {
        ($('[data-role="use-existing"]', root) as HTMLButtonElement).onclick = () => { close(); activateConn(existing.id); };
      });
  }

  return { render };
}

// Helpers
function apiField(label: string, input: HTMLInputElement, help: string): HTMLElement {
  const field = el('div', 'api-field');
  field.appendChild(el('label', 'api-label', esc(label)));
  field.appendChild(input);
  field.appendChild(el('div', 'api-help', esc(help)));
  return field;
}
