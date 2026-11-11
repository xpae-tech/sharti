// Bootstrap + Server-Sent Events connection

import { S, applyModels } from './state.js';
import { api, refreshApiCaps } from './api.js';
import { applyNativeToolsState } from './native-tools.js';
import { syncThemeFromPrefs } from './theme.js';
import type { BootstrapResponse, DownloadState, EngineState, ExternalApiPayload, ModelsPayload, McpState, NativeToolsState } from '../types';

interface SSERenderDeps {
  loadChats: () => Promise<void>;
  renderAll: () => void;
  renderStateDependent: () => void;
  renderServer: () => void;
  renderControlBar: () => void;
  renderComposer: () => void;
  renderConversationMarks: () => void;
  renderToolsBar: () => void;
  onMcpUpdate: (state: McpState) => void;
  toast: (msg: string) => void;
  isApiMutating: () => boolean;
  updateDownloadInPlace: () => boolean;
  /** Navigate to engine view + open settings (used to surface download errors). */
  surfaceEngineView: () => void;
}

export function createSSE(deps: SSERenderDeps) {
  async function bootstrap(): Promise<void> {
    let b: BootstrapResponse;
    try { b = await api('GET', '/api/bootstrap'); }
    catch (e: unknown) { showOffline((e as Error).message); return; }

    S.runtime = b.runtime;
    S.blocker = b.blocker;
    S.ramGb = b.ramGb;
    S.state = b.state;
    S.download = b.download;
    S.externalApi = b.externalApi || { connections: [], activeId: null, active: null, connected: false };
    if (S.externalApi.connected) {
      S.apiUrlDraft = S.externalApi.active?.baseUrl || '';
      S.apiNameDraft = S.externalApi.active?.name || '';
      S.apiKeyDraft = S.externalApi.active?.apiKey || '';
      S.apiModelNameDraft = S.externalApi.active?.modelName || '';
      S.apiModelIdDraft = S.externalApi.active?.modelId || '';
      refreshApiCaps();
    }
    S.prefs = b.prefs || S.prefs;
    S.splashApiKeySet = b.splashApiKeySet === true;
    syncThemeFromPrefs();
    if (Array.isArray(S.prefs.enabledMcpServers)) {
      S.enabledMcpServers = new Set(S.prefs.enabledMcpServers);
    }
    if (Array.isArray(S.prefs.disabledMcpServers)) {
      S.disabledMcpServers = new Set(S.prefs.disabledMcpServers);
    }
    for (const id of S.disabledMcpServers) S.enabledMcpServers.delete(id);
    if (b.mcp) {
      S.mcpTools = b.mcp.tools ?? [];
      S.mcpServers = b.mcp.servers ?? [];
    }
    if (b.nativeTools) applyNativeToolsState(b.nativeTools);
    applyModels(b.models);
    await deps.loadChats();
    deps.renderAll();
  }

  function showOffline(msg: string): void {
    S.blocker = 'Cannot reach the Sharti Web backend.';
    deps.renderAll();
    deps.toast('Backend unavailable: ' + msg);
  }

  function connectSSE(): void {
    const es = new EventSource('/api/events');
    const stable = (o: EngineState): Omit<EngineState, 'uptimeSec'> => {
      const { uptimeSec: _omit, ...rest } = o;
      return rest;
    };

    es.onopen = async () => {
      try {
        // Re-hydrate everything that is otherwise only delivered through
        // one-shot broadcasts. A reconnect (or a bootstrap that failed while
        // the backend was starting) must not leave tools silently missing.
        const [st, apiSt, nativeState, mcpState] = await Promise.all([
          api('GET', '/api/state') as Promise<EngineState>,
          api('GET', '/api/api-status') as Promise<ExternalApiPayload>,
          api('GET', '/api/native-tools') as Promise<NativeToolsState>,
          api('GET', '/api/mcp') as Promise<McpState>,
        ]);
        S.state = st;
        S.externalApi = apiSt;
        applyNativeToolsState(nativeState);
        deps.onMcpUpdate(mcpState);
        if (S.externalApi.connected) refreshApiCaps();
        deps.renderStateDependent();
        deps.renderComposer();
      } catch { /* noop */ }
    };

    es.addEventListener('state', (e: MessageEvent) => {
      const st: EngineState = JSON.parse(e.data);
      const prev = S.state ? stable(S.state) : null;
      if (prev === null || JSON.stringify(stable(st)) !== JSON.stringify(prev)) {
        S.state = st;
        deps.renderStateDependent();
      } else {
        S.state = st;
      }
    });

    es.addEventListener('download', (e: MessageEvent) => {
      const wasRunning = S.download?.running;
      const next: DownloadState = JSON.parse(e.data);
      S.download = next;
      if (next.running) {
        if (!wasRunning) {
          // Just started — full render needed to create the download card in DOM
          deps.renderServer();
        } else if (S.serverView === 'engine') {
          // Card already present — lightweight in-place progress update
          deps.updateDownloadInPlace();
        }
      } else if (wasRunning && next.failure) {
        // Surface the error: jump to engine view where the problem row lives
        deps.surfaceEngineView();
        deps.renderServer();
      } else {
        deps.renderServer();
        if (wasRunning && next.model) deps.toast('Model downloaded');
      }
    });

    es.addEventListener('models', (e: MessageEvent) => {
      const data = JSON.parse(e.data) as ModelsPayload & { notification?: string };
      if (data.notification === 'models_changed') {
        api('GET', '/api/models').then((mp: ModelsPayload) => {
          applyModels(mp);
          deps.renderServer();
          deps.renderControlBar();
        }).catch(() => { /* noop */ });
      } else {
        applyModels(data);
        deps.renderServer();
        deps.renderControlBar();
      }
    });

    es.addEventListener('api-status', (e: MessageEvent) => {
      if (deps.isApiMutating()) return;
      S.externalApi = JSON.parse(e.data);
      refreshApiCaps();
      deps.renderControlBar();
      deps.renderComposer();
      deps.renderConversationMarks();
      if (S.settingsOpen) deps.renderServer();
    });

    es.addEventListener('mcp', (e: MessageEvent) => {
      deps.onMcpUpdate(JSON.parse(e.data) as McpState);
      deps.renderToolsBar();
    });

    es.addEventListener('native-tools', (e: MessageEvent) => {
      applyNativeToolsState(JSON.parse(e.data) as NativeToolsState);
      deps.renderToolsBar();
    });

    es.onerror = () => { /* auto-reconnect */ };
  }

  return { bootstrap, connectSSE };
}
