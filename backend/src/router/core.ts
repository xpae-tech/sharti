import type { Hono } from 'hono';
import fs from 'node:fs';
import type { RouterContext } from './context.js';
import { redactPrefs } from '../domain/types.js';
import { createSseStream } from '../infra/sse-hub.js';
import { resolveWithin } from '../infra/paths.js';
import { modelFiles, removeInstalledModel } from '../services/model-files.js';
import { revealInFinder } from './net.js';

export function registerCoreRoutes(app: Hono, ctx: RouterContext): void {
  const { services, buildModelsPayload } = ctx;
  const { cfg, prefs, sse, engine, downloader, externalApi, mcp, nativeTools } = services;

  // ── SSE ───────────────────────────────────────────────────────────────────
  app.get('/api/events', (c) => {
    const stream = createSseStream(sse);
    return c.newResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  });

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  app.get('/api/bootstrap', async (c) => {
    const blocker = await engine.deviceCheck();
    const prefData = prefs.load();
    return c.json({
      runtime: cfg.splashRoot ? {
        root: cfg.splashRoot,
        python: cfg.pythonBin,
        engine: cfg.enginePath,
        packaged: cfg.isPackaged,
      } : null,
      blocker,
      ramGb: cfg.ramGb,
      state: engine.getState(),
      download: downloader.getState(),
      prefs: redactPrefs(prefData),
      splashApiKeySet: Boolean(prefData.options.apiKey),
      models: buildModelsPayload(),
      externalApi: externalApi.payload(),
      mcp: mcp.getState(),
      nativeTools: nativeTools.getState(),
    });
  });

  // ── State / models ────────────────────────────────────────────────────────
  app.get('/api/state', (c) => c.json(engine.getState()));
  app.get('/api/models', (c) => c.json(buildModelsPayload()));


  // ── Engine control ────────────────────────────────────────────────────────
  app.post('/api/start', async (c) => {
    const body = await c.req.json();
    if (!body.model) return c.json({ error: "'model' required" }, 400);
    // A user-initiated download and a model start cannot share the slot.
    // A switch during the engine's own preparation is allowed.
    if (downloader.getState().running && !engine.isPreparing()) {
      return c.json({ error: 'A model download is already in progress' }, 409);
    }
    prefs.update((p) => { p.selectedModel = body.model; });
    const result = engine.start(body.model, body.options ?? prefs.load().options);
    return c.json(result, result.ok ? 200 : 400);
  });

  app.post('/api/stop', (c) => c.json(engine.stop()));

  app.post('/api/show-in-finder', async (c) => {
    const body = await c.req.json();
    const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : '';
    const files = modelId ? modelFiles(cfg.modelsRoot, modelId) : null;
    if (files) {
      // Hugging Face keeps the weights under its own cache; the app's models
      // directory holds an owner folder with a link per installed variant.
      revealIfPresent(fs.existsSync(files.hubDir) ? files.hubDir : files.hubRoot);
      // Select the per-variant link inside the owner folder. A missing link
      // (stale UI or an already removed model) falls back to the owner folder.
      revealIfPresent(fs.existsSync(files.linkPath) ? files.linkPath : files.ownerDir);
      return c.json({ ok: true });
    }

    if (!body.path) return c.json({ error: "'path' required" }, 400);
    const target = resolveWithin(cfg.modelsRoot, String(body.path));
    if (!target) return c.json({ error: 'Path is outside the models directory' }, 400);
    revealInFinder(target);
    return c.json({ ok: true });
  });

  app.post('/api/models/delete', async (c) => {
    const body = await c.req.json();
    const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : '';
    if (!modelId) return c.json({ error: "'modelId' required" }, 400);

    const state = engine.getState();
    const busy = state.model === modelId && (
      state.phase === 'ready' || state.phase === 'starting' || state.phase === 'stopping'
    );
    if (busy) return c.json({ error: 'Stop the model before deleting it' }, 409);
    // A download or engine preparation writes the same resolved and Hub
    // caches; deleting while it runs could corrupt the installation.
    if (downloader.getState().running || engine.isPreparing()) {
      return c.json({ error: 'Wait for the model download to finish' }, 409);
    }

    const result = removeInstalledModel(cfg, modelId);
    const models = buildModelsPayload();
    // Always publish the current list: a partial filesystem failure must not
    // leave the UI showing a model that is already partly gone.
    sse.broadcast('models', models);
    if (!result.ok) {
      return c.json({ error: result.error ?? 'Could not delete model', models }, result.notFound ? 404 : 500);
    }

    return c.json({ ok: true, models });
  });

  // ── Downloads ─────────────────────────────────────────────────────────────
  app.get('/api/download', (c) => c.json(downloader.getState()));

  app.post('/api/download', async (c) => {
    const body = await c.req.json();
    if (!body.model) return c.json({ error: "'model' required" }, 400);
    // The engine owns the download slot while it prepares a model.
    if (engine.isPreparing()) {
      return c.json({ error: 'A model is being prepared' }, 409);
    }
    const r = downloader.start(body.model);
    return c.json(r.ok ? downloader.getState() : r, r.ok ? 200 : 400);
  });

  app.delete('/api/download', (c) => {
    downloader.cancel();
    // An engine preparation owns its own child process, so it is cancelled
    // through the engine as well; this is a no-op while serving.
    engine.cancelPreparation();
    return c.json(downloader.getState());
  });

  app.post('/api/dismiss-download', (c) => {
    downloader.dismissFailure();
    return c.json(downloader.getState());
  });

  // ── Preferences ───────────────────────────────────────────────────────────
  app.get('/api/prefs', (c) => c.json(redactPrefs(prefs.load())));

  app.put('/api/prefs', async (c) => {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return c.json({ error: 'bad body' }, 400);
    }
    if (body.options != null && (typeof body.options !== 'object' || Array.isArray(body.options))) {
      return c.json({ error: "'options' must be an object" }, 400);
    }
    if (body.options && 'apiKey' in body.options
      && body.options.apiKey != null && typeof body.options.apiKey !== 'string') {
      return c.json({ error: "'options.apiKey' must be a string" }, 400);
    }
    const updated = prefs.update((p) => {
      const previousKey = p.options.apiKey;
      // External connections are owned by the /api/api-* endpoints; the
      // browser always sees a redacted copy and must not overwrite secrets.
      delete body.apiConnections;
      delete body.activeApiId;
      Object.assign(p, body);
      p.options = p.options ?? {};
      // An omitted key means "keep the stored value"; an explicit empty
      // string means the user cleared it.
      if (!body.options || !Object.prototype.hasOwnProperty.call(body.options, 'apiKey')) {
        if (previousKey) p.options.apiKey = previousKey;
        else delete p.options.apiKey;
      }
    });
    return c.json(redactPrefs(updated));
  });
}

/** Reveal a folder only when it exists; a missing cache path is not an error. */
function revealIfPresent(target: string): void {
  if (fs.existsSync(target)) revealInFinder(target);
}
