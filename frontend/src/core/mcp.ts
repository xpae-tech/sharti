// MCP state helpers shared by the tools bar and the Plugins & MCP settings tab.

import { S } from './state.js';
import type { McpState } from '../types';

export type McpServerStatus = 'disabled' | 'inactive' | 'active';

/** Resolve the user-facing activity state of one configured MCP server. */
export function mcpServerStatus(serverId: string): McpServerStatus {
  if (S.disabledMcpServers.has(serverId)) return 'disabled';
  return S.enabledMcpServers.has(serverId) ? 'active' : 'inactive';
}

/** Replace the known server/tool lists and prune IDs that no longer exist. */
export function applyMcpState(state: McpState): void {
  S.mcpServers = state.servers ?? [];
  S.mcpTools = state.tools ?? [];

  const validIds = new Set(S.mcpServers.map((s) => s.id));
  for (const id of [...S.enabledMcpServers]) {
    if (!validIds.has(id) || S.disabledMcpServers.has(id)) S.enabledMcpServers.delete(id);
  }
  for (const id of [...S.disabledMcpServers]) {
    if (!validIds.has(id)) S.disabledMcpServers.delete(id);
  }
}

/** Mirror the in-memory sets into prefs before they are persisted. */
export function snapshotMcpPrefs(): void {
  S.prefs.enabledMcpServers = [...S.enabledMcpServers];
  S.prefs.disabledMcpServers = [...S.disabledMcpServers];
}
