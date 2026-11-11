import type { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import type { RouterContext } from './context.js';
import { resolveWithin } from '../infra/paths.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html;charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function mimeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function registerStaticRoutes(app: Hono, ctx: RouterContext): void {
  const { frontendDir } = ctx.services.cfg;

  app.get('*', async (c) => {
    let urlPath: string;
    try { urlPath = decodeURIComponent(c.req.path); } catch { return c.text('Bad request', 400); }
    const relative = (urlPath === '/' ? 'index.html' : urlPath).replace(/^\/+/, '');
    const filePath = resolveWithin(frontendDir, relative);
    if (!filePath) return c.text('Forbidden', 403);
    try {
      if (!fs.statSync(filePath).isFile()) return c.text(`404: ${urlPath}`, 404);
      const data = fs.readFileSync(filePath);
      return c.body(new Uint8Array(data), 200, {
        'content-type': mimeFor(filePath),
        'cache-control': filePath.includes(`${path.sep}assets${path.sep}`)
          ? 'public, max-age=31536000, immutable'
          : 'no-cache',
      });
    } catch {
      return c.text(`404: ${urlPath}`, 404);
    }
  });
}
