import { defineConfig, loadEnv } from 'vite';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_BACKEND_PORT, DEFAULT_FRONTEND_PORT } from './shared/app-defaults';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')) as { version: string };

export default defineConfig(({ mode }) => {
  // Load the same project-root .env as the backend. Only VITE_* variables are
  // exposed to the browser; SHARTI_* values stay in the dev-server config.
  const fileEnv = loadEnv(mode, __dirname, '');
  const BACKEND_PORT = Number(process.env.SHARTI_BACKEND_PORT || fileEnv.SHARTI_BACKEND_PORT || DEFAULT_BACKEND_PORT);
  const FRONTEND_PORT = Number(process.env.SHARTI_FRONTEND_PORT || fileEnv.SHARTI_FRONTEND_PORT || DEFAULT_FRONTEND_PORT);

  return {
    root: path.join(__dirname, 'frontend'),
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
