import type { Hono } from 'hono';
import type { RouterContext } from './context.js';
import type { ApiConnection } from '../domain/types.js';
import { redactApiConnection } from '../domain/types.js';
import { HTTP_TIMEOUTS } from '../config/index.js';
import { uuid } from '../domain/preferences.js';
import { modelsUrl, normalizeBaseUrl, probeEndpoint } from './net.js';

const clean = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

/** Fetches an arbitrary URL from a connection, reusing its auth header. */
async function fetchConnectionUrl(conn: ApiConnection, url: string): Promise<Response> {
  return fetch(url, {
    headers: conn.apiKey ? { authorization: `Bearer ${conn.apiKey}` } : {},
    signal: AbortSignal.timeout(HTTP_TIMEOUTS.connectionProbeMs),
  });
}

/** Fetches model metadata directly from a connection (never via the active
 * proxy target), so capability discovery works even while the engine is the
 * currently routed target. */
async function fetchConnectionModels(conn: ApiConnection, suffix = ''): Promise<Response> {
  return fetchConnectionUrl(conn, modelsUrl(conn.baseUrl, suffix));
}

export function registerApiConnectionRoutes(app: Hono, ctx: RouterContext): void {
  const { services, persistApiConns } = ctx;
  const { sse, externalApi } = services;

  app.get('/api/api-status', (c) => c.json(externalApi.payload()));

  // Provider capability discovery, pinned to the active external connection.
  // The generic /proxy route follows connectionMode, which may point at the
  // local engine; the composer still needs the external model's metadata.
  app.get('/api/api-models', async (c) => {
    const conn = externalApi.connections.find((cn) => cn.id === externalApi.activeId);
    if (!conn) return c.json({ error: 'No active connection' }, 404);
    try {
      const upstream = await fetchConnectionModels(conn);
      const text = await upstream.text();
      return c.body(text, upstream.status as 200, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      });
    } catch (e) {
      return c.json({ error: (e as Error).message }, 502);
    }
  });

  // LM Studio (and some local engines) expose richer reasoning options only
  // in their native model list (`/api/v1/models` or legacy `/api/v0/models`).
  app.get('/api/api-models/native', async (c) => {
    const conn = externalApi.connections.find((cn) => cn.id === externalApi.activeId);
    if (!conn) return c.json({ error: 'No active connection' }, 404);
    const primary = modelsUrl(conn.baseUrl);
    const origin = new URL(conn.baseUrl).origin;
    for (const nativePath of ['/api/v1/models', '/api/v0/models']) {
      const url = `${origin}${nativePath}`;
      if (url === primary) continue;
      try {
        const upstream = await fetchConnectionUrl(conn, url);
        if (!upstream.ok) continue;
        const text = await upstream.text();
        return c.body(text, 200, {
          'content-type': upstream.headers.get('content-type') ?? 'application/json',
          'cache-control': 'no-store',
        });
      } catch { /* try the next native path */ }
    }
    return c.json({ models: [] });
  });

  // Optional single-model metadata. Providers that do not implement it are
  // normalized to an empty 200 response so capability discovery stays quiet.
  app.get('/api/api-models/detail', async (c) => {
    const conn = externalApi.connections.find((cn) => cn.id === externalApi.activeId);
    const id = c.req.query('id');
    if (!conn || !id) return c.json({ models: [] });
    try {
      const upstream = await fetchConnectionModels(conn, `/${encodeURIComponent(id)}`);
      if (!upstream.ok) return c.json({ models: [] });
      const text = await upstream.text();
      return c.body(text, 200, {
        'content-type': upstream.headers.get('content-type') ?? 'application/json',
        'cache-control': 'no-store',
      });
    } catch {
      return c.json({ models: [] });
    }
  });

  app.post('/api/api-connect', async (c) => {
    const body = await c.req.json();
    const url = (body.url ?? '').trim();
    if (!url) return c.json({ error: 'Missing URL' }, 400);

    const normalized = normalizeBaseUrl(url);
    if (!normalized) return c.json({ error: 'Invalid URL' }, 400);

    const dup = externalApi.connections.find((cn) => cn.baseUrl === normalized);
    if (dup) return c.json({ error: 'duplicate_connection', existing: redactApiConnection(dup) }, 409);

    const apiKey = clean(body.apiKey);
    const models = await probeEndpoint(normalized, apiKey);
    if (models === null) {
      return c.json({ error: apiKey ? 'Cannot reach endpoint or the API key is invalid' : 'Cannot reach endpoint' }, 502);
    }

    const modelId = clean(body.modelId) || models[0] || '';
    const modelName = clean(body.modelName) || modelId;
    const conn: ApiConnection = {
      id: uuid(),
      name: clean(body.name),
      baseUrl: normalized,
      apiKey,
      modelName,
      modelId,
    };
    externalApi.connections.push(conn);
    externalApi.activeId = conn.id;
    persistApiConns();
    sse.broadcast('api-status', externalApi.payload());
    return c.json({ ok: true, connection: redactApiConnection(conn) });
  });

  app.post('/api/api-disconnect', (c) => {
    externalApi.activeId = null;
    persistApiConns();
    sse.broadcast('api-status', externalApi.payload());
    return c.json({ ok: true });
  });

  app.post('/api/api-activate/:id', async (c) => {
    const id = decodeURIComponent(c.req.param('id'));
    const conn = externalApi.connections.find((cn) => cn.id === id);
    if (!conn) return c.json({ error: 'Not found' }, 404);
    const models = await probeEndpoint(conn.baseUrl, conn.apiKey);
    if (models === null) {
      return c.json({ error: conn.apiKey ? 'Cannot reach endpoint or the API key is invalid' : 'Cannot reach endpoint' }, 502);
    }
    // Upgrade connections saved before model fields existed.
    if (!conn.modelId && models.length) conn.modelId = models[0];
    if (!conn.modelName) conn.modelName = conn.modelId;
    externalApi.activeId = conn.id;
    persistApiConns();
    sse.broadcast('api-status', externalApi.payload());
    return c.json({ ok: true, connection: redactApiConnection(conn) });
  });

  app.put('/api/api-connections/:id', async (c) => {
    const id = decodeURIComponent(c.req.param('id'));
    const conn = externalApi.connections.find((cn) => cn.id === id);
    if (!conn) return c.json({ error: 'Not found' }, 404);
    const body = await c.req.json();
    if ('name' in body) conn.name = clean(body.name);
    if ('baseUrl' in body) {
      const normalized = normalizeBaseUrl(clean(body.baseUrl));
      if (!normalized) return c.json({ error: 'Invalid URL' }, 400);
      conn.baseUrl = normalized;
    }
    if ('apiKey' in body) {
      // The browser never receives stored keys. A non-empty value replaces the
      // key; an empty value means "unchanged". Clearing requires the explicit
      // `clearApiKey` flag.
      const nextKey = clean(body.apiKey);
      if (nextKey) conn.apiKey = nextKey;
    }
    if (body.clearApiKey === true) conn.apiKey = '';
    if ('modelName' in body) conn.modelName = clean(body.modelName);
    if ('modelId' in body) conn.modelId = clean(body.modelId);
    persistApiConns();
    sse.broadcast('api-status', externalApi.payload());
    return c.json({ ok: true, connection: redactApiConnection(conn) });
  });

  app.delete('/api/api-connections/:id', (c) => {
    const id = decodeURIComponent(c.req.param('id'));
    const idx = externalApi.connections.findIndex((cn) => cn.id === id);
    if (idx < 0) return c.json({ error: 'Not found' }, 404);
    if (externalApi.activeId === id) externalApi.activeId = null;
    externalApi.connections.splice(idx, 1);
    persistApiConns();
    sse.broadcast('api-status', externalApi.payload());
    return c.json({ ok: true });
  });
}
