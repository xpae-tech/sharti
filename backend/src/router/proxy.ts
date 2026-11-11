import type { Hono } from 'hono';
import crypto from 'node:crypto';
import type { RouterContext } from './context.js';
import { isAllowedOrigin } from '../infra/origins.js';
import { snapshotHeaders, type LlmLogEntry, type LlmLogRequest, type LlmLogResponse } from '../services/llm-log.js';

const HOP_BY_HOP = new Set(['host', 'content-length', 'origin', 'referer', 'connection', 'x-chat-id']);

/** Request paths that carry LLM traffic and are worth logging. */
const LLM_PATH = /(?:completions|responses|embeddings)$/;

/** Parses a JSON request body for the log, keeping raw text as a fallback. */
function snapshotBody(buffer: ArrayBuffer | undefined): unknown {
  if (!buffer || buffer.byteLength === 0) return null;
  const text = Buffer.from(buffer).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function registerProxyRoutes(app: Hono, ctx: RouterContext): void {
  const { services, allowedOrigins } = ctx;
  const { cfg, prefs, engine, externalApi, conversations } = services;

  app.get('/api/live-status', async (c) => {
    const state = engine.getState();
    const apiKey = prefs.load().options.apiKey || cfg.splashApiKey;
    try {
      const res = await fetch(`http://127.0.0.1:${state.port}/status`, {
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      });
      if (res.status === 200) return c.json(await res.json());
    } catch { /* unreachable */ }
    return c.json({ error: 'unreachable' }, 503);
  });

  app.all('/proxy/*', async (c) => {
    const incoming = new URL(c.req.url);
    const pathOnly = incoming.pathname.slice('/proxy'.length) || '/';
    const apiPath = pathOnly + incoming.search;
    const isLlmPath = LLM_PATH.test(pathOnly);

    const prefData = prefs.load();
    const mode = prefData.connectionMode || 'auto';
    const extActive = externalApi.connections.find((cn) => cn.id === externalApi.activeId);
    const engPhase = engine.getState().phase;
    const engAlive = engPhase === 'ready' || engPhase === 'starting';
    const useExt = !!extActive && (mode !== 'engine' || !engAlive);
    const target = useExt && extActive
      ? `${extActive.baseUrl}${apiPath}`
      : `http://127.0.0.1:${engine.getState().port}${apiPath}`;

    const headers = new Headers();
    c.req.raw.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
    });
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    // The local engine's optional API key travels in its environment; the
    // proxy is the app's client and must present it on every engine request.
    const engineApiKey = prefData.options.apiKey || cfg.splashApiKey;
    if (!useExt && engineApiKey) {
      headers.set('authorization', `Bearer ${engineApiKey}`);
    }
    // External APIs authenticate with their own saved key.
    if (useExt && extActive?.apiKey) {
      headers.set('authorization', `Bearer ${extActive.apiKey}`);
    }

    const hasBody = c.req.method !== 'GET' && c.req.method !== 'HEAD';
    let bodyBuffer: ArrayBuffer | undefined = hasBody ? await c.req.arrayBuffer() : undefined;

    // The saved model ID is authoritative for the external API; rewrite it
    // into model-bearing requests so a stale UI selection cannot override it.
    if (useExt && extActive?.modelId && bodyBuffer && bodyBuffer.byteLength > 0) {
      if (isLlmPath) {
        try {
          const json = JSON.parse(Buffer.from(bodyBuffer).toString('utf8')) as Record<string, unknown>;
          if (json && typeof json === 'object') {
            json.model = extActive.modelId;
            const rewritten = Buffer.from(JSON.stringify(json));
            bodyBuffer = rewritten.buffer.slice(rewritten.byteOffset, rewritten.byteOffset + rewritten.byteLength) as ArrayBuffer;
          }
        } catch { /* not JSON: forward as-is */ }
      }
    }

    // ── LLM traffic log ─────────────────────────────────────────────────────
    // A chat attaches its ID through the X-Chat-Id header. Logging is opt-in
    // (Settings → System → Logging) and never affects the proxy response.
    const chatId = (c.req.header('x-chat-id') ?? '').trim();
    const logging = prefData.llmLogging === true && chatId.length > 0 && isLlmPath;
    const startedAt = Date.now();
    let logRequest: LlmLogRequest | null = null;
    if (logging) {
      logRequest = {
        method: c.req.method,
        url: target,
        headers: snapshotHeaders(headers),
        body: snapshotBody(bodyBuffer),
      };
    }

    const writeLog = (response: LlmLogResponse | null, error?: string): void => {
      if (!logging || !logRequest) return;
      const entry: LlmLogEntry = {
        id: crypto.randomUUID(),
        chatId,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        target: useExt ? 'external' : 'engine',
        request: logRequest,
        response,
        ...(error ? { error } : {}),
      };
      try {
        conversations.appendLlmLog(chatId, entry);
      } catch (e) {
        console.warn('[llm-log] failed to append log entry:', (e as Error).message);
      }
    };

    try {
      const upstream = await fetch(target, {
        method: c.req.method,
        headers,
        body: bodyBuffer && bodyBuffer.byteLength > 0 ? bodyBuffer : undefined,
      });
      const contentType = upstream.headers.get('content-type') ?? 'application/json';
      const origin = c.req.header('origin');
      const responseHeaders: Record<string, string> = {
        'content-type': contentType,
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
        vary: 'Origin',
      };
      if (origin && isAllowedOrigin(origin, allowedOrigins)) responseHeaders['access-control-allow-origin'] = origin;

      // Snapshot response metadata only when logging is enabled.
      const responseBase = logging
        ? { status: upstream.status, headers: snapshotHeaders(upstream.headers) }
        : null;
      const loggedResponse = (body: string, complete: boolean): LlmLogResponse | null =>
        responseBase ? { ...responseBase, body, complete } : null;

      const reader = upstream.body?.getReader();
      if (reader) {
        let captured = '';
        const decoder = logging ? new TextDecoder() : null;
        let written = false;

        const finalize = (complete: boolean, error?: string): void => {
          if (!logging || written) return;
          written = true;
          // Flush any buffered multi-byte sequence from the decoder.
          captured += decoder?.decode() ?? '';
          writeLog(loggedResponse(captured, complete), error);
        };

        const stream = new ReadableStream({
          async pull(controller) {
            let result: ReadableStreamReadResult<Uint8Array>;
            try {
              result = await reader.read();
            } catch (err) {
              finalize(false, (err as Error).message);
              controller.error(err);
              return;
            }
            const { done, value } = result;
            if (done) {
              finalize(true);
              controller.close();
              return;
            }
            if (decoder && value) captured += decoder.decode(value, { stream: true });
            controller.enqueue(value);
          },
          cancel(reason) {
            finalize(false, 'client disconnected before the response completed');
            reader.cancel(reason).catch(() => {});
          },
        });
        return c.newResponse(stream, upstream.status as 200, responseHeaders);
      }

      const text = await upstream.text();
      writeLog(loggedResponse(text, true));
      return c.body(text, upstream.status as 200, {
        ...responseHeaders,
        'content-length': String(Buffer.byteLength(text)),
      });
    } catch (err) {
      writeLog(null, (err as Error).message);
      return c.json({ error: `Proxy failed: ${(err as Error).message}` }, 502);
    }
  });
}
