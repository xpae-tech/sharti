import { execFile } from 'node:child_process';
import { HTTP_TIMEOUTS } from '../config/index.js';

/** Best-effort macOS Finder reveal. Failures are intentionally silent. */
export function revealInFinder(target: string): void {
  execFile('open', ['-R', target], () => { /* ignore */ });
}

/** Strips a trailing `/vN` suffix and trailing slashes from a base URL. */
export function normalizeBaseUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    const normPath = u.pathname.replace(/\/+$/, '');
    const stripped = normPath.replace(/\/v\d+$/i, '');
    return u.origin + (stripped ? stripped : '');
  } catch {
    return null;
  }
}

/** Builds the `/v1/models` URL for an OpenAI-compatible base URL. */
export function modelsUrl(baseUrl: string, suffix = ''): string {
  const u = new URL(baseUrl);
  const base = (u.pathname.replace(/\/+$/, '') || '') + '/v1/models';
  return `${u.origin}${base}${suffix}`;
}

/**
 * Checks an OpenAI-compatible endpoint's `/v1/models` and returns its model
 * IDs. `null` means unreachable or the API key was rejected.
 */
export async function probeEndpoint(baseUrl: string, apiKey?: string): Promise<string[] | null> {
  try {
    const headers: Record<string, string> = {};
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const res = await fetch(modelsUrl(baseUrl), {
      headers,
      signal: AbortSignal.timeout(HTTP_TIMEOUTS.endpointProbeMs),
    });
    if (res.status < 200 || res.status >= 400) return null;
    const body = await res.json().catch(() => null) as { data?: Array<{ id?: unknown }> } | null;
    return Array.isArray(body?.data)
      ? body!.data.map((m) => m.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
  } catch {
    return null;
  }
}
