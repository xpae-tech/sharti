import type { Hono } from 'hono';
import path from 'node:path';
import type { RouterContext } from './context.js';
import type { McpToolCallParams } from '../domain/types.js';

export function registerMcpRoutes(app: Hono, ctx: RouterContext): void {
  const { services } = ctx;
  const { cfg, mcp } = services;
  const mcpConfigPath = (): string =>
    path.relative(path.dirname(cfg.projectRoot), mcp.getConfigPath()).split(path.sep).join('/');

  app.get('/api/mcp', (c) => c.json(mcp.getState()));

  app.get('/api/mcp/config', (c) => c.json({
    path: mcpConfigPath(),
    absolutePath: mcp.getConfigPath(),
    content: mcp.readConfigText(),
  }));

  app.put('/api/mcp/config', async (c) => {
    const body = await c.req.json().catch(() => null) as { content?: unknown } | null;
    const content = typeof body?.content === 'string' ? body.content : '';
    const invalid = validateMcpConfig(content);
    if (invalid) return c.json({ error: invalid }, 400);
    try {
      mcp.saveConfigText(content);
      await mcp.reload();
      return c.json({ ok: true, path: mcpConfigPath(), absolutePath: mcp.getConfigPath(), state: mcp.getState() });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
  });

  // Kept for external automation that re-reads the file after an out-of-band
  // edit; the editor uses PUT /api/mcp/config, which reloads on save.
  app.post('/api/mcp/refresh', async (c) => {
    try {
      await mcp.reload();
      return c.json(mcp.getState());
    } catch (e) {
      return c.json({ error: (e as Error).message }, 500);
    }
  });

  app.post('/api/mcp/call', async (c) => {
    const body = await c.req.json() as McpToolCallParams;
    if (!body.serverId || !body.toolName) {
      return c.json({ error: "'serverId' and 'toolName' required" }, 400);
    }
    try {
      return c.json(await mcp.callTool({
        serverId: body.serverId,
        toolName: body.toolName,
        arguments: body.arguments ?? {},
      }));
    } catch (e) {
      return c.json({ content: [{ type: 'text', text: (e as Error).message }], isError: true });
    }
  });
}

/** Returns a human-readable validation error, or null when the config is usable. */
function validateMcpConfig(content: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    return `Invalid JSON: ${(e as Error).message}`;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return 'mcp.json must contain a JSON object';
  }
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (servers === undefined) return null;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    return '"mcpServers" must be an object';
  }
  for (const [id, cfg] of Object.entries(servers)) {
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
      return `Server "${id}" must be an object`;
    }
    if (typeof (cfg as { command?: unknown }).command !== 'string') {
      return `Server "${id}" must have a string "command"`;
    }
  }
  return null;
}
