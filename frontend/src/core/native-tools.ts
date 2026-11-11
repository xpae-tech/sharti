// Native tools (sharti-agent) state helpers.
// The backend state is authoritative: the UI never infers the master switch
// from preferences, which can lag behind a toggle or a detached session.

import { S } from './state.js';
import { api } from './api.js';
import type { NativeToolsState } from '../types';

/**
 * Toggles the native tool suite. State is updated optimistically and rolled
 * back when the backend rejects the change; callers re-render afterwards.
 * Returns true when the backend confirmed the new value.
 */
export async function setNativeToolsEnabled(enabled: boolean): Promise<boolean> {
  const previous = S.nativeToolsEnabled;
  S.nativeToolsEnabled = enabled;
  S.prefs.nativeToolsEnabled = enabled;
  try {
    await api('POST', '/api/native-tools/toggle', { enabled });
    return true;
  } catch {
    S.nativeToolsEnabled = previous;
    S.prefs.nativeToolsEnabled = previous;
    return false;
  }
}

/** Mirrors a backend native-tools snapshot into the UI state. */
export function applyNativeToolsState(state: NativeToolsState): void {
  S.nativeToolDefs = state.tools ?? [];
  S.nativeToolsInitialized = state.initialized ?? false;
  S.nativeToolsEnabled = typeof state.enabled === 'boolean'
    ? state.enabled
    : S.nativeToolsInitialized && S.prefs.nativeToolsEnabled !== false;
}

/**
 * Re-fetches the native-tools state. Used when the local snapshot may be
 * stale — e.g. after a reconnect or a toggle whose SSE confirmation was
 * missed — so native tools are never silently omitted from a request.
 */
export async function refreshNativeToolsState(): Promise<void> {
  try {
    applyNativeToolsState(await api('GET', '/api/native-tools'));
  } catch { /* keep the current snapshot */ }
}
