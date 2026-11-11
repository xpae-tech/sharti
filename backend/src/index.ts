import { serve } from '@hono/node-server';
import { ENGINE, loadConfig } from './config/index.js';
import { createApp } from './app.js';
import { ExternalApiState, type AppServices } from './app-services.js';
import { loadCatalog } from './domain/catalog.js';
import { PreferenceStore } from './domain/preferences.js';
import { SseHub } from './infra/sse-hub.js';
import { EngineManager } from './services/engine-manager.js';
import { DownloadManager } from './services/download-manager.js';
import { ConversationStore } from './services/conversation-store.js';
import { FolderStore } from './services/folder-store.js';
import { McpManager } from './services/mcp-manager.js';
import { NativeToolsManager } from './services/native-tools.js';
import path from 'node:path';
import fs from 'node:fs';

// ─── Boot Sequence ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const cfg = loadConfig(process.argv.slice(2));

  console.log('='.repeat(56));
  console.log('  Sharti — Independent Web Service');
  console.log('='.repeat(56));

  if (!cfg.splashRoot) {
    console.warn('\n[warn] Splash runtime not found.');
    console.warn('Set SHARTI_SPLASH_RUNTIME env var or pass --runtime /path/to/splash');
    console.warn('(expected a directory containing install/launcher.py)');
    console.warn('Service will start in degraded mode (external APIs only).\n');
  }

  console.log(`  Project:  ${cfg.projectRoot}`);
  console.log(`  Runtime:  ${cfg.splashRoot ?? '(not configured)'}`);
  console.log(`  Python:   ${cfg.pythonBin}`);
  console.log(`  Engine:   ${cfg.enginePath ?? '(not found)'}`);
  console.log(`  Models:   ${cfg.modelsRoot || '(none)'}`);
  console.log(`  RAM:      ${cfg.ramGb} GB`);
  console.log(`  Port:     ${cfg.port}`);
  console.log('');

  // Ensure data directories exist
  fs.mkdirSync(cfg.chatsDir, { recursive: true });
  fs.mkdirSync(cfg.foldersDir, { recursive: true });
  fs.mkdirSync(cfg.mcpDir, { recursive: true });

  // Initialize services
  const catalogPath = cfg.splashRoot
    ? path.join(cfg.splashRoot, 'install', 'suggested-models.tsv')
    : null;
  const catalog = loadCatalog(catalogPath);
  const prefs = new PreferenceStore(cfg.prefsFile);
  const sse = new SseHub();
  const downloader = new DownloadManager(cfg);
  const engine = new EngineManager(cfg, catalog, downloader);
  const conversations = new ConversationStore(cfg.chatsDir, cfg.foldersDir);
  const folders = new FolderStore(cfg.foldersDir);
  const mcp = new McpManager(cfg.mcpJsonPath);
  const nativeTools = new NativeToolsManager(() => prefs.load());
  nativeTools.init();

  // Wire SSE broadcasts to engine state changes
  engine.onStateChange((state) => {
    sse.broadcast('state', state);
  });

  // Wire SSE broadcasts to download state changes.
  // Detect the running→stopped transition so the model list always refreshes
  // regardless of whether the process exited successfully.
  let prevDownloadRunning = false;
  downloader.onStateChange((state) => {
    sse.broadcast('download', state);
    if (prevDownloadRunning && !state.running) {
      sse.broadcast('models', { notification: 'models_changed' });
    }
    prevDownloadRunning = state.running;
  });

  // Wire MCP state changes to SSE
  mcp.onStateChange(() => {
    sse.broadcast('mcp', mcp.getState());
  });

  // Wire native tools state changes to SSE
  nativeTools.onStateChange(() => {
    sse.broadcast('native-tools', nativeTools.getState());
  });

  // External API connections (initialized from persisted prefs)
  const initialPrefs = prefs.load();
  const externalApi = new ExternalApiState(initialPrefs.apiConnections ?? []);
  // Restore active connection ID if it still refers to a valid connection
  if (initialPrefs.activeApiId && externalApi.connections.some((c) => c.id === initialPrefs.activeApiId)) {
    externalApi.activeId = initialPrefs.activeApiId;
  }

  const services: AppServices = {
    cfg,
    catalog,
    prefs,
    sse,
    engine,
    downloader,
    conversations,
    folders,
    externalApi,
    mcp,
    nativeTools,
  };

  const app = createApp(services);

  // Stop leftover processes from previous sessions
  await engine.stopLeftovers();

  // Initialise MCP servers (non-blocking: failures logged, app continues)
  mcp.init().catch((e) => console.warn('[mcp] init error:', e.message));

  // Background device check
  engine.deviceCheck().then((reason) => {
    if (reason) console.log(`[warn] device-check: ${reason}`);
  });

  // Start HTTP server
  const server = serve({
    fetch: app.fetch,
    port: cfg.port,
    hostname: '127.0.0.1',
  });

  console.log(`  ✓ http://localhost:${cfg.port}`);
  console.log('  Press Ctrl+C to stop.');
  console.log('-'.repeat(56));

  // Graceful shutdown
  const shutdown = (): void => {
    console.log('\n[shutdown] Stopping server…');
    try { engine.dispose(); } catch { /* ignore */ }
    try { downloader.dispose(); } catch { /* ignore */ }
    try { mcp.dispose(); } catch { /* ignore */ }
    try { nativeTools.dispose(); } catch { /* ignore */ }
    sse.destroy();
    server.close();
    setTimeout(() => process.exit(0), ENGINE.shutdownExitDelayMs);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
