import type { Hono } from 'hono';
import type { RouterContext } from './context.js';

export function registerNativeToolRoutes(app: Hono, ctx: RouterContext): void {
  const { services } = ctx;
  const { prefs, sse, nativeTools } = services;

  app.get('/api/native-tools', (c) => c.json(nativeTools.getState()));

  app.post('/api/native-tools/toggle', async (c) => {
    const body = await c.req.json();
    const enabled = typeof body.enabled === 'boolean' ? body.enabled : !prefs.load().nativeToolsEnabled;
    prefs.update((p) => { p.nativeToolsEnabled = enabled; });
    sse.broadcast('native-tools', nativeTools.getState());
    return c.json(nativeTools.getState());
  });

  // Per-tool controls are kept for external integrations; the settings UI
  // toggles the whole suite through /api/native-tools/toggle.
  app.post('/api/native-tools/disable-tool', async (c) => {
    const body = await c.req.json();
    const name = body.toolName as string | undefined;
    if (!name) return c.json({ error: "'toolName' required" }, 400);
    prefs.update((p) => {
      if (!p.disabledNativeTools.includes(name)) p.disabledNativeTools.push(name);
    });
    sse.broadcast('native-tools', nativeTools.getState());
    return c.json(nativeTools.getState());
  });

  app.post('/api/native-tools/enable-tool', async (c) => {
    const body = await c.req.json();
    const name = body.toolName as string | undefined;
    if (!name) return c.json({ error: "'toolName' required" }, 400);
    prefs.update((p) => {
      p.disabledNativeTools = p.disabledNativeTools.filter((n) => n !== name);
    });
    sse.broadcast('native-tools', nativeTools.getState());
    return c.json(nativeTools.getState());
  });

  app.post('/api/native-tools/call', async (c) => {
    const body = await c.req.json();
    const toolName = body.toolName as string | undefined;
    if (!toolName) return c.json({ error: "'toolName' required" }, 400);
    try {
      return c.json(await nativeTools.callTool(toolName, (body.arguments ?? {}) as Record<string, unknown>));
    } catch (e) {
      return c.json({ content: [{ type: 'text', text: (e as Error).message }], isError: true });
    }
  });
}
