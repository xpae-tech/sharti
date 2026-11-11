// HTTP client + external API capability discovery

import { S } from './state.js';
import { parseModelCapabilities } from '../../../shared/reasoning.js';

// Subscribers notified after apiCaps mutate (so dependent UI re-renders reactively)
const _capsListeners: Array<() => void> = [];
export function onApiCapsChanged(fn: () => void): void { _capsListeners.push(fn); }
function notifyCapsChanged(): void { for (const fn of _capsListeners) { try { fn(); } catch { /* */ } } }

export async function api(method: string, path: string, body?: unknown, formData?: FormData): Promise<any> {
  const opts: RequestInit = { method, headers: {} };
  if (formData) {
    // Don't set Content-Type manually – browser sets boundary
    opts.body = formData;
  } else if (body !== undefined) {
    (opts.headers as Record<string, string>)['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    let msg = `${res.status}`;
    try { const j = await res.json(); msg = j.error || j.message || msg; } catch { /* noop */ }
    throw new Error(msg);
  }
  return ct.includes('json') ? res.json() : res;
}

function capabilitiesFrom(model: Record<string, any>) {
  return parseModelCapabilities(model) ?? { acceptsImages: false, context: null, reasoning: null };
}

function modelFromPayload(payload: any, id: string): Record<string, any> | null {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.data && !Array.isArray(payload.data) && typeof payload.data === 'object') {
    return payload.data;
  }
  const models: any[] = Array.isArray(payload.models)
    ? payload.models
    : Array.isArray(payload.data)
      ? payload.data
      : [];
  if (models.length === 0) return payload.id || payload.key ? payload : null;
  return models.find((m) => m.key === id
    || m.id === id
    || m.name === id
    || (Array.isArray(m.loaded_instances) && m.loaded_instances.some((i: any) => i?.id === id))) ?? models[0];
}

function isLocalEndpoint(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host.endsWith('.local')) {
      return true;
    }
    const m = host.match(/^(\d+)\.(\d+)\./);
    if (!m) return false;
    const a = Number(m[1]);
    const b = Number(m[2]);
    return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
  } catch {
    return false;
  }
}

async function fetchNativeModel(modelId: string): Promise<Record<string, any> | null> {
  try {
    const res = await fetch('/api/api-models/native');
    if (!res.ok) return null;
    return modelFromPayload(await res.json(), modelId);
  } catch {
    return null;
  }
}

export async function refreshApiCaps(): Promise<void> {
  if (!S.externalApi.connected) { S.apiCaps = null; notifyCapsChanged(); return; }
  try {
    const res = await fetch('/api/api-models');
    if (!res.ok) return;
    const jm: any = await res.json();
    const models: any[] = Array.isArray(jm.data) ? jm.data : [];
    const wanted = S.externalApi.active?.modelId;
    const m = (wanted ? models.find((x) => x.id === wanted) : null) || models[0];
    if (!m) return;

    let caps = capabilitiesFrom(m);

    // Some gateways expose richer metadata on the single-model endpoint
    // (notably OpenRouter-style APIs and LM Studio). Consulting it costs one
    // cheap request and is the only way to surface provider-advertised levels.
    // Optional single-model metadata, for providers that expose more than the
    // list endpoint. A missing implementation is a quiet empty response.
    if (!caps.reasoning || caps.reasoning.efforts.length === 0) {
      try {
        const detailRes = await fetch(`/api/api-models/detail?id=${encodeURIComponent(m.id)}`);
        if (detailRes.ok) {
          const dm = modelFromPayload(await detailRes.json(), m.id);
          if (dm) {
            const detailed = capabilitiesFrom(dm);
            caps = {
              acceptsImages: caps.acceptsImages || detailed.acceptsImages,
              context: caps.context ?? detailed.context,
              reasoning: detailed.reasoning ?? caps.reasoning,
            };
          }
        }
      } catch { /* optional detail endpoint */ }
    }

    // LM Studio exposes reasoning levels only in its native model list.
    // Probe it only for local/LAN endpoints to avoid pointless remote calls.
    if ((!caps.reasoning || caps.reasoning.efforts.length === 0)
      && isLocalEndpoint(S.externalApi.active?.baseUrl)) {
      const native = await fetchNativeModel(m.id);
      if (native) {
        const detailed = capabilitiesFrom(native);
        caps = {
          acceptsImages: caps.acceptsImages || detailed.acceptsImages,
          context: caps.context ?? detailed.context,
          reasoning: detailed.reasoning ?? caps.reasoning,
        };
      }
    }

    S.apiCaps = caps;
    notifyCapsChanged();
  } catch { /* ignore – caps stay stale until next refresh */ }
}


export async function savePrefs(): Promise<void> {
  try { await api('PUT', '/api/prefs', S.prefs); } catch { /* noop */ }
}
