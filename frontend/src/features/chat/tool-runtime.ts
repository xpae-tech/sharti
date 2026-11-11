// Tool runtime shared by the chat agent loop: selects the active tool surface
// (MCP + native), maps definitions to the OpenAI wire format, and executes a
// call against the matching backend endpoint.

import { S, currentTuning } from '../../core/state.js';
import { api } from '../../core/api.js';
import { NATIVE_SERVER_ID } from '../../types';
import type { McpToolDef } from '../../types';

/** Convert an McpToolDef to the OpenAI function-calling format. */
export function toOpenAiTool(def: McpToolDef): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema,
    },
  };
}

/** Currently enabled tool definitions for inclusion in the wire body. */
export function getActiveToolDefs(): McpToolDef[] {
  if (!currentTuning().toolChoice) return [];
  const mcpTools = S.mcpTools.filter((t) => S.enabledMcpServers.has(t.serverId) && !S.disabledMcpServers.has(t.serverId));
  const nativeTools = S.nativeToolsEnabled ? S.nativeToolDefs : [];
  return [...mcpTools, ...nativeTools];
}

/** Look up the serverId for a tool name from all known tools (MCP + native). */
export function findServerForTool(toolName: string): string | null {
  if (S.nativeToolDefs.some((t) => t.name === toolName)) return NATIVE_SERVER_ID;
  const tool = S.mcpTools.find((t) => t.name === toolName);
  return tool ? tool.serverId : null;
}

/** Shape of the raw structured payload returned by the native/MCP call endpoints. */
type RawToolPayload = { content?: Array<{ type: string; text?: string }>; isError?: boolean };

/** Render the raw structured result as JSON for display.
    A lone text block that carries a JSON document is surfaced directly (so
    native tools that return JSON documents aren't double-encoded); anything
    else is emitted as the full content array. Guarantees "always JSON". */
function resultToJson(raw: RawToolPayload | null): string {
  const content = raw?.content ?? [];
  if (content.length === 1 && content[0].type === 'text' && typeof content[0].text === 'string') {
    const t = content[0].text.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try { return JSON.stringify(JSON.parse(t), null, 2); } catch { /* not JSON — fall through */ }
    }
  }
  return JSON.stringify(content.length ? content : (raw ?? null), null, 2);
}

/** Wrap a plain failure message as a single-text-block JSON payload. */
function textBlockJson(msg: string): string {
  return JSON.stringify([{ type: 'text', text: msg }], null, 2);
}

/** Execute a tool — routes to native or MCP endpoint based on serverId.
    Returns both a human/model-facing `text` and a display-ready `json`. */
export async function executeMcpTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ text: string; json: string; isError: boolean }> {
  const serverId = findServerForTool(toolName);
  if (!serverId) {
    const msg = `Unknown tool: ${toolName}`;
    return { text: msg, json: textBlockJson(msg), isError: true };
  }
  try {
    let result: RawToolPayload;
    if (serverId === NATIVE_SERVER_ID) {
      result = await api('POST', '/api/native-tools/call', { toolName, arguments: args });
    } else {
      result = await api('POST', '/api/mcp/call', { serverId, toolName, arguments: args });
    }
    const contentArr: Array<{ type: string; text?: string }> = result.content ?? [];
    const text = contentArr
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!)
      .join('\n');
    return { text: text || '(no output)', json: resultToJson(result), isError: result.isError ?? false };
  } catch (e) {
    const msg = `Execution failed: ${(e as Error).message}`;
    return { text: msg, json: textBlockJson(msg), isError: true };
  }
}
