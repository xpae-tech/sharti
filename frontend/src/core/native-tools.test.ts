import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S } from './state.js';
import { applyNativeToolsState, setNativeToolsEnabled } from './native-tools.js';
import type { NativeToolsState } from '../types';

describe('applyNativeToolsState', () => {
  beforeEach(() => {
    S.nativeToolsEnabled = false;
    S.nativeToolsInitialized = false;
    S.nativeToolDefs = [];
    S.prefs.nativeToolsEnabled = true;
  });

  it('uses the backend enabled flag as the source of truth', () => {
    const tools = [{
      id: 'sharti-agent:read_file',
      serverId: 'sharti-agent',
      name: 'read_file',
      description: '',
      inputSchema: {},
    }];

    applyNativeToolsState({ tools, initialized: true, enabled: true });
    expect(S.nativeToolsEnabled).toBe(true);
    expect(S.nativeToolDefs).toEqual(tools);

    applyNativeToolsState({ tools: [], initialized: true, enabled: false });
    expect(S.nativeToolsEnabled).toBe(false);
    expect(S.nativeToolDefs).toEqual([]);
  });

  it('falls back to the preference for older payloads without a flag', () => {
    const legacy = { tools: [], initialized: true } as unknown as NativeToolsState;
    applyNativeToolsState(legacy);
    expect(S.nativeToolsEnabled).toBe(true);

    S.prefs.nativeToolsEnabled = false;
    applyNativeToolsState(legacy);
    expect(S.nativeToolsEnabled).toBe(false);
  });
});

describe('setNativeToolsEnabled', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists the new value on success', async () => {
    S.nativeToolsEnabled = true;
    S.prefs.nativeToolsEnabled = true;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ tools: [], initialized: true, enabled: false }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(setNativeToolsEnabled(false)).resolves.toBe(true);
    expect(S.nativeToolsEnabled).toBe(false);
    expect(S.prefs.nativeToolsEnabled).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith('/api/native-tools/toggle', expect.objectContaining({ method: 'POST' }));
  });

  it('rolls state back when the backend rejects the change', async () => {
    S.nativeToolsEnabled = true;
    S.prefs.nativeToolsEnabled = true;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })));

    await expect(setNativeToolsEnabled(false)).resolves.toBe(false);
    expect(S.nativeToolsEnabled).toBe(true);
    expect(S.prefs.nativeToolsEnabled).toBe(true);
  });
});
