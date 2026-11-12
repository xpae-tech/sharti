import { defineConfig, loadEnv, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_BACKEND_PORT, DEFAULT_FRONTEND_PORT } from './shared/app-defaults';
import { buildFavicon, FAVICON_ICO, FAVICON_SOURCE } from './tools/build-favicon';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')) as { version: string };

/**
 * Keeps frontend/assets/favicon.ico in sync with sharti-favicon.svg.
 * Regenerates on dev-server start, on every SVG change (followed by a full
 * reload), and before production builds.
 */
function faviconPlugin(): Plugin {
  let isServe = false;
  let queue: Promise<void> = Promise.resolve();

  const regenerate = (): Promise<void> => {
    queue = queue
      .then(async () => {
        const { changed, bytes } = await buildFavicon();
        if (changed) console.log(`[favicon] generated ${path.basename(FAVICON_ICO)} (${bytes} bytes)`);
      })
      .catch((error: unknown) => {
        console.error('[favicon] generation failed', error);
      });
    return queue;
  };

  return {
    name: 'sharti:favicon',
    configResolved(config) {
      isServe = config.command === 'serve';
    },
    async buildStart() {
      await regenerate();
    },
    configureServer(server) {
      const onAssetChange = (file: string): void => {
        if (path.resolve(file) !== FAVICON_SOURCE) return;
        void regenerate().then(() => server.ws.send({ type: 'full-reload' }));
      };
      server.watcher.add(FAVICON_SOURCE);
      server.watcher.on('add', onAssetChange);
      server.watcher.on('change', onAssetChange);
    },
    transformIndexHtml(html) {
      if (!isServe) return html;
      const version = Math.max(
        fs.statSync(FAVICON_SOURCE).mtimeMs,
        fs.statSync(FAVICON_ICO).mtimeMs,
      );
      return html.replace(
        /(href="\.\/assets\/(?:sharti-favicon\.svg|favicon\.ico))"/g,
        `$1?v=${Math.round(version)}"`,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load the same project-root .env as the backend. Only VITE_* variables are
  // exposed to the browser; SHARTI_* values stay in the dev-server config.
  const fileEnv = loadEnv(mode, __dirname, '');
  const BACKEND_PORT = Number(process.env.SHARTI_BACKEND_PORT || fileEnv.SHARTI_BACKEND_PORT || DEFAULT_BACKEND_PORT);
  const FRONTEND_PORT = Number(process.env.SHARTI_FRONTEND_PORT || fileEnv.SHARTI_FRONTEND_PORT || DEFAULT_FRONTEND_PORT);

  return {
    root: path.join(__dirname, 'frontend'),
    plugins: [faviconPlugin()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    server: {
      port: FRONTEND_PORT,
      open: true,
      proxy: {
        '/api': {
          target: `http://127.0.0.1:${BACKEND_PORT}`,
          changeOrigin: true,
        },
        '/proxy': {
          target: `http://127.0.0.1:${BACKEND_PORT}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: '../dist/frontend',
      emptyOutDir: true,
      rollupOptions: {
        input: path.join(__dirname, 'frontend', 'index.html'),
      },
    },
  };
});
