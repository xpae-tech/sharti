import { beforeEach, describe, expect, it } from 'vitest';
import { S } from './state.js';
import { applyMcpState, mcpServerStatus, snapshotMcpPrefs } from './mcp.js';

beforeEach(() => {
  S.mcpServers = [];
  S.mcpTools = [];
  S.enabledMcpServers.clear();
  S.disabledMcpServers.clear();
  S.prefs.enabledMcpServers = [];
  S.prefs.disabledMcpServers = [];
});

describe('MCP activity state', () => {
  it('resolves disabled, inactive, and active statuses', () => {
    S.disabledMcpServers.add('off');
    S.enabledMcpServers.add('on');
    expect(mcpServerStatus('off')).toBe('disabled');
    expect(mcpServerStatus('on')).toBe('active');
    expect(mcpServerStatus('idle')).toBe('inactive');
  });

  it('prunes unknown IDs and never keeps a server active while disabled', () => {
    S.mcpServers = [{ id: 'a', label: 'A', status: 'ready', error: null }];
    S.enabledMcpServers.add('a');
    S.enabledMcpServers.add('gone');
    S.disabledMcpServers.add('a');
    S.disabledMcpServers.add('gone');

    applyMcpState({ servers: S.mcpServers, tools: [], lastLoaded: null });

    expect([...S.enabledMcpServers]).toEqual([]);
    expect([...S.disabledMcpServers]).toEqual(['a']);
  });

  it('snapshots both sets into prefs', () => {
    S.enabledMcpServers.add('a');
    S.disabledMcpServers.add('b');
    snapshotMcpPrefs();
    expect(S.prefs.enabledMcpServers).toEqual(['a']);
    expect(S.prefs.disabledMcpServers).toEqual(['b']);
  });
});
