// Control bar: displays active tool status, allows switching between API/Engine

import { el, esc, $ } from '../../core/dom.js';
import { S, apiName, nameOf, isExternalApiActive } from '../../core/state.js';
import { api, savePrefs } from '../../core/api.js';
import { cap, shortUrl } from '../../core/format.js';
import { connectionLabel, connectionTargets, openConnectionPicker, selectConnection } from '../../ui/connection-picker.js';
import { toast, copyText } from '../../core/feedback.js';
import type { Elements, EngineState } from '../../types';

interface ControlBarDeps {
  renderServer: () => void;
  renderComposer: () => void;
  renderConversationMarks: () => void;
  beginApiMutation: () => () => void;
  refreshApiStatus: () => void;
  refreshApiCaps: () => void;
  start: (model: string) => void;
}

export function createControlBar(E: Elements, deps: ControlBarDeps) {
  function renderControlBar(): void {
    const apiConnected = S.externalApi.connected;
    const engAlive = S.state && (S.state.phase === 'ready' || S.state.phase === 'starting' || S.state.phase === 'stopping');

    let displayTool: 'api' | 'engine' | null = null;
    if (S.settingsOpen && S.settingsTab === 'connection') {
      if (S.serverView === 'api') displayTool = apiConnected ? 'api' : null;
      else if (S.serverView === 'engine') displayTool = engAlive ? 'engine' : null;
      else {
        if (isExternalApiActive()) displayTool = 'api';
        else if (engAlive) displayTool = 'engine';
        else if (apiConnected) displayTool = 'api';
      }
    } else {
      if (isExternalApiActive()) displayTool = 'api';
      else if (engAlive) displayTool = 'engine';
      else if (apiConnected) displayTool = 'api';
    }

    if (!displayTool) { E.controlBar.hidden = true; return; }
    E.controlBar.hidden = false;

    if (displayTool === 'api') {
      E.cbMark.dataset.look = 'on';
      E.cbModel.textContent = apiName();
      const active = S.externalApi.active;
      E.cbDetail.innerHTML = esc([active?.modelId, shortUrl(active?.baseUrl || '')].filter(Boolean).join(' \u00b7 '));
      const box = E.cbActions; box.innerHTML = '';
      const dbtn = el('button', 'btn', 'Disconnect') as HTMLButtonElement;
      dbtn.onclick = async () => {
        const release = deps.beginApiMutation();
        S.externalApi = { connections: S.externalApi.connections, activeId: null, active: null, connected: false };
        S.apiUrlDraft = ''; S.apiNameDraft = '';
        S.apiKeyDraft = ''; S.apiModelNameDraft = ''; S.apiModelIdDraft = '';
        deps.refreshApiCaps();
        deps.renderServer(); renderControlBar(); deps.renderComposer(); deps.renderConversationMarks();
        try { await api('POST', '/api/api-disconnect'); }
        catch { await deps.refreshApiStatus(); }
        release();
      };
      box.appendChild(dbtn);
    } else {
      const st = S.state!;
      E.cbMark.dataset.look = markLookForBar(st);
      E.cbModel.textContent = st.model ? nameOf(st.model) : '\u00a0';
      E.cbDetail.innerHTML = cbDetailHtml(st);
      renderCbActions(st);
    }

    const switchable = connectionTargets().length >= 2;
    E.cbModel.classList.toggle('interactive', switchable);
    E.cbModel.onclick = switchable ? () => openPicker() : null;
  }

  function openPicker(): void {
    openConnectionPicker(E.cbModel, (target) => {
      selectConnection(target);
      savePrefs();
      deps.refreshApiCaps();
      renderControlBar();
      deps.renderComposer();
      toast('Using ' + connectionLabel(target), E.toast);
    });
  }

  function renderCbActions(st: EngineState): void {
    const box = E.cbActions; box.innerHTML = '';
    const add = (label: string, fn: () => void, cls?: string, disabled?: boolean): void => { const b = el('button', cls || 'btn', esc(label)) as HTMLButtonElement; b.onclick = fn; if (disabled) b.disabled = true; box.appendChild(b); };
    const sel = S.prefs.selectedModel;
    if (st.phase === 'starting') {
      add('Cancel', () => { api('POST', '/api/stop'); }, 'btn');
    } else if (st.phase === 'stopping') {
      if (st.next) add('Cancel', () => { api('POST', '/api/stop'); }, 'btn');
    } else if (st.phase === 'ready') {
      if (sel && sel !== st.model) {
        add('Stop', () => { api('POST', '/api/stop'); }, 'btn');
        add(`Switch to ${nameOf(sel!)}`, () => deps.start(sel!), 'btn prominent');
      } else {
        add('Stop', () => { api('POST', '/api/stop'); }, 'btn');
      }
    }
    const cp = $('#copyApi');
    if (cp) (cp as HTMLButtonElement).onclick = () => { copyText(st.apiAddress!); toast('Copied API address', E.toast); };
  }

  return { renderControlBar };
}


function markLookForBar(st: EngineState): string {
  const failedPicked = st.phase === 'failed' && st.model === S.prefs.selectedModel;
  if (st.phase === 'failed' && !failedPicked) return 'off';
  return st.markLook || 'off';
}

function cbDetailHtml(st: EngineState): string {
  switch (st.phase) {
    case 'starting': {
      const secs = st.stepSince ? Math.floor((Date.now() - st.stepSince) / 1000) : 0;
      return secs < 3 ? `${esc(st.step!)}\u2026` : `${esc(st.step!)} \u00b7 ${secs}s`;
    }
    case 'stopping': return st.next ? `Switching to ${esc(nameOf(st.next))}\u2026` : 'Stopping\u2026';
    case 'ready':
      if (st.serving === 'recovering') return esc(cap(st.serving));
      return `${esc(cap(st.serving!))} \u00b7 Port ${st.port}<button class="link-btn" id="copyApi" style="padding:0 4px;">Copy API</button>`;
    case 'failed': return st.model === S.prefs.selectedModel ? 'Ran into a problem' : 'Not responding';
    default: return 'Not running';
  }
}
