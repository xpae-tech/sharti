import { Hono } from 'hono';
import type { AppServices } from './app-services.js';
import { buildAllowedOrigins, isAllowedOrigin } from './infra/origins.js';
import { createRouterContext } from './router/context.js';
import { registerCoreRoutes } from './router/core.js';
import { registerChatRoutes } from './router/chats.js';
import { registerApiConnectionRoutes } from './router/api-connections.js';
import { registerMcpRoutes } from './router/mcp.js';
import { registerNativeToolRoutes } from './router/native-tools.js';
import { registerProxyRoutes } from './router/proxy.js';
import { registerStaticRoutes } from './router/static.js';

// ─── App Factory ────────────────────────────────────────────────────────────

export function createApp(services: AppServices): Hono {
  const app = new Hono();
  const allowedOrigins = buildAllowedOrigins(services.cfg);

  // CORS + browser-origin guard. Requests without an Origin header (curl,
  // native clients, same-origin GET) are allowed; browser requests must come
  // from a loopback origin or an explicitly configured one.
  app.use('*', async (c, next) => {
    const origin = c.req.header('origin');
    if (origin && !isAllowedOrigin(origin, allowedOrigins)) {
      return c.json({ error: 'Origin not allowed' }, 403);
    }
    if (origin) c.header('Access-Control-Allow-Origin', origin);
    c.header('Vary', 'Origin');
    c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Chat-Id');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });

  const ctx = createRouterContext(services, allowedOrigins);

  // Each router owns one bounded context; adding a feature means adding a
  // registration call here, not editing every existing route.
  registerCoreRoutes(app, ctx);
  registerChatRoutes(app, ctx);
  registerApiConnectionRoutes(app, ctx);
  registerMcpRoutes(app, ctx);
  registerNativeToolRoutes(app, ctx);
  registerProxyRoutes(app, ctx);
  registerStaticRoutes(app, ctx);

  return app;
}
