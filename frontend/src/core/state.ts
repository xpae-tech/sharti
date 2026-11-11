// Application-wide mutable state. Single source of truth.
// Kept as a flat object for simplicity; modules import it directly.

import type { AppState, Conversation, Draft, ModelsPayload, Prefs } from '../types';
import { createDefaultPrefs } from '../types';
import { effectiveTuning } from '../../../shared/tuning.js';
import { modelDisplayName } from '../../../shared/model-id.js';
import { validEffort } from './effort.js';

export const S: AppState = {
  settingsOpen: false,
  settingsTab: 'connection',
  serverView: 'method',
  externalApi: { connections: [], activeId: null, active: null, connected: false },
  apiUrlDraft: '',
  apiNameDraft: '',
  apiKeyDraft: '',
  apiModelNameDraft: '',
  apiModelIdDraft: '',
  runtime: null,
  blocker: null,
  state: null,
  download: null,
  models: [],
  suggestions: [],
  ramGb: 0,
  prefs: createDefaultPrefs(),
  splashApiKeySet: false,
  chats: [],
  convs: new Map<string, Conversation>(),
  currentId: null,
  draft: { text: '', attachments: [] },
  drafts: new Map<string, Draft>(),
  streaming: null,
  streamAbort: null,
  apiCaps: null,
  advanced: false,
  searchQuery: '',
  mcpTools: [],
  mcpServers: [],
  enabledMcpServers: new Set<string>(),
  disabledMcpServers: new Set<string>(),
  nativeToolsEnabled: true,
  nativeToolsInitialized: false,
  nativeToolDefs: [],
  folders: [],
  expandedFolders: new Set<string>(),
};

// ── Derived selectors ─────────────────────────────────────────────

export const ready = (): boolean => !S.blocker;

/** Normalized connection mode ('auto' is the implicit default). */
export const connectionMode = (): Prefs['connectionMode'] => S.prefs.connectionMode || 'auto';

export function serverAnswers(): boolean {
  if (connectionMode() === 'engine' && !(S.state && S.state.phase === 'ready')) {
    // Graceful degradation: engine pinned but dead → fall back to API if available
    return isExternalApiActive();
  }
  if (connectionMode() === 'engine') return !!(S.state && S.state.phase === 'ready');
  return (S.state && S.state.phase === 'ready') || isExternalApiActive();
}

export const apiName = (): string =>
  S.externalApi.active?.modelName || S.externalApi.active?.name || 'External API';

/** Model identifier sent to the external API. */
export const externalModelId = (): string =>
  S.externalApi.active?.modelId || S.externalApi.active?.modelName || '';

export function activeServiceName(): string {
  if (isExternalApiActive()) return apiName();
  if (S.state && S.state.model) return nameOf(S.state.model);
  return 'Model';
}

/** True when traffic is routed to the external API rather than the local engine. */
export function isExternalApiActive(): boolean {
  if (!S.externalApi.connected) return false;
  const mode = connectionMode();
  // Graceful degradation: if user pinned 'engine' but the engine is dead and
  // an external API is connected, prefer the API over a useless lock.
  if (mode === 'engine') {
    const engAlive = S.state && (S.state.phase === 'ready' || S.state.phase === 'starting');
    return !engAlive;
  }
  return true;
}

/** True when the service that will receive the next request accepts images. */
export function acceptsImages(): boolean {
  if (isExternalApiActive()) return S.apiCaps ? S.apiCaps.acceptsImages : true;
  return !!(S.state && S.state.phase === 'ready' && S.state.acceptsImages);
}

/** Maximum context window advertised by the service handling the next request. */
export function contextLimit(): number | null {
  if (isExternalApiActive()) return S.apiCaps?.context ?? null;
  return S.state?.context ?? null;
}

/**
 * Resolves the reasoning-effort token to attach to an outgoing chat-completion
 * request. Mirrors the key scheme used when storing the user's selection in the
 * composer: '__api' in external-API mode, otherwise the loaded model's id.
 * Returns '' when no explicit override is stored, letting the server apply its
 * own default.
 */
export function reasoningEffortToSend(): string {
  // No tuning attributes at all when Custom Sampling is off.
  const tuning = effectiveTuning(S.prefs.tuning, S.prefs.options);
  if (!tuning.customSampling) return '';

  const caps = isExternalApiActive()
    ? S.apiCaps?.reasoning
    : S.state?.reasoning;
  if (!caps || !caps.thinks) return '';

  const stored = isExternalApiActive()
    ? (S.prefs.efforts['__api'] || '')
    : (() => {
        const model = S.state && S.state.model;
        return model ? (S.prefs.efforts[model] || '') : '';
      })();

  return validEffort(caps, stored);
}

/** Resolved global tuning for the current preferences. */
export function currentTuning() {
  return effectiveTuning(S.prefs.tuning, S.prefs.options);
}

export const currentConv = (): Conversation | null => (S.currentId ? S.convs.get(S.currentId) ?? null : null);

/** Replace the model catalog from a server payload, keeping selection valid. */
export function applyModels(mp: ModelsPayload): void {
  S.models = mp.models || [];
  S.suggestions = mp.suggestions || [];
  S.ramGb = mp.ramGb || S.ramGb;
  if (S.prefs.selectedModel && !S.models.find((m) => m.id === S.prefs.selectedModel)) {
    S.prefs.selectedModel = S.models[0]?.id || null;
  }
}

export const isStreamingHere = (): boolean => S.streaming != null && S.streaming === S.currentId;

// ── Per-conversation draft management ─────────────────────────────

export function stashCurrentDraft(): void {
  if (S.currentId && (S.draft.text || S.draft.attachments.length)) {
    S.drafts.set(S.currentId, { text: S.draft.text, attachments: S.draft.attachments.slice() });
  } else if (S.currentId) {
    S.drafts.delete(S.currentId);
  }
}

export function restoreDraft(onApply?: () => void): void {
  const d = S.currentId ? S.drafts.get(S.currentId) : undefined;
  S.draft = d ? { text: d.text, attachments: d.attachments.slice() } : { text: '', attachments: [] };
  if (onApply) onApply();
}

// ── Model name resolution ─────────────────────────────────────────

export function nameOf(id: string): string {
  return S.state && id === S.state.model ? (S.state.modelDisplayName || id) : prettyName(id);
}

export function prettyName(id: string): string {
  if (!id) return '';
  const sug = S.suggestions.find((v) => v.id === id);
  if (sug) return sug.name;
  return modelDisplayName(id);
}
