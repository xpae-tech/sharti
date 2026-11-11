import type { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import type { RouterContext } from './context.js';
import type { ChatMessage } from '../domain/types.js';
import { UPLOADS } from '../config/index.js';
import { uuid } from '../domain/preferences.js';
import { resolveWithin } from '../infra/paths.js';
import { revealInFinder } from './net.js';

export function registerChatRoutes(app: Hono, ctx: RouterContext): void {
  const { services } = ctx;
  const { cfg, conversations, folders } = services;

  const chatId = (c: { req: { param: (n: string) => string } }): string =>
    decodeURIComponent(c.req.param('id'));

  // ── Conversations ─────────────────────────────────────────────────────────
  app.get('/api/chats', (c) => c.json({ chats: conversations.list() }));

  app.post('/api/chats', async (c) => {
    const body = await c.req.json();
    const conv = conversations.create(body.id ?? uuid(), body.name ?? body.title ?? '');
    return c.json(conv, 201);
  });

  app.get('/api/chats/:id', (c) => {
    const conv = conversations.get(chatId(c));
    return conv ? c.json(conv) : c.json({ error: 'not found' }, 404);
  });

  app.put('/api/chats/:id', async (c) => {
    const id = chatId(c);
    const body = await c.req.json();
    if (!body || !Array.isArray(body.messages)) return c.json({ error: 'bad body' }, 400);
    const tokenCount = typeof body.tokenCount === 'number' && Number.isFinite(body.tokenCount) && body.tokenCount >= 0
      ? Math.floor(body.tokenCount)
      : undefined;
    const conv = conversations.update(id, body.messages as ChatMessage[], body.name ?? body.title, tokenCount);
    return c.json(conv);
  });

  app.patch('/api/chats/:id', async (c) => {
    const id = chatId(c);
    const body = await c.req.json();
    if (body.name != null || body.title != null) {
      const conv = conversations.patchName(id, body.name ?? body.title);
      return conv ? c.json(conv) : c.json({ error: 'not found' }, 404);
    }
    return c.json({ error: 'nothing to patch' }, 400);
  });

  app.delete('/api/chats/:id', (c) => {
    conversations.delete(chatId(c));
    return c.json({ ok: true });
  });

  app.post('/api/chats/:id/reveal', async (c) => {
    const filePath = conversations.revealPath(chatId(c));
    if (!filePath) return c.json({ error: 'not found' }, 404);
    revealInFinder(filePath);
    return c.json({ ok: true });
  });

  // ── Chat files ────────────────────────────────────────────────────────────
  app.post('/api/chats/:id/files', async (c) => {
    const id = chatId(c);
    const conv = conversations.get(id);
    if (!conv) return c.json({ error: 'not found' }, 404);

    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) return c.json({ error: 'missing file' }, 400);
    if (file.size > UPLOADS.maxBytes) {
      return c.json({ error: `File is too large (max ${Math.round(UPLOADS.maxBytes / 1024 / 1024)} MB)` }, 413);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const meta = conversations.uploadFile(id, buffer, file.name, file.type);
    return c.json(meta, 201);
  });

  app.get('/api/chats/:id/files/:filename', (c) => {
    const id = chatId(c);
    const filename = decodeURIComponent(c.req.param('filename'));
    const result = conversations.getFileBuffer(id, filename);
    if (!result) return c.json({ error: 'file not found' }, 404);
    return c.body(new Uint8Array(result.buffer), 200, {
      'content-type': result.mimeType,
      'cache-control': 'private, max-age=86400',
    });
  });

  app.get('/api/chats/:id/files', (c) => c.json({ files: conversations.listFiles(chatId(c)) }));

  app.post('/api/chats/:id/files/:filename/reveal', async (c) => {
    const id = chatId(c);
    const filename = decodeURIComponent(c.req.param('filename'));
    const result = conversations.getFileBuffer(id, filename);
    if (!result) return c.json({ error: 'file not found' }, 404);
    const candidate = path.join(cfg.chatsDir, id, 'files', path.basename(filename));
    const filePath = resolveWithin(cfg.chatsDir, candidate);
    if (!filePath || !fs.existsSync(filePath)) return c.json({ error: 'file not found' }, 404);
    revealInFinder(filePath);
    return c.json({ ok: true });
  });

  // ── Folders ───────────────────────────────────────────────────────────────
  app.get('/api/folders', (c) => c.json({ folders: folders.list() }));

  app.post('/api/folders', async (c) => {
    const body = await c.req.json();
    const folder = folders.create(uuid(), body.name ?? 'New folder');
    return c.json(folder, 201);
  });

  app.patch('/api/folders/:id', async (c) => {
    const id = decodeURIComponent(c.req.param('id'));
    const body = await c.req.json();
    if (body.name == null) return c.json({ error: "'name' required" }, 400);
    const folder = folders.patchName(id, body.name);
    return folder ? c.json(folder) : c.json({ error: 'not found' }, 404);
  });

  app.delete('/api/folders/:id', (c) => {
    const id = decodeURIComponent(c.req.param('id'));
    const chatIds = conversations.chatIdsInFolder(id);
    for (const cid of chatIds) conversations.delete(cid);
    const ok = folders.delete(id);
    return ok ? c.json({ ok: true, deletedChats: chatIds.length }) : c.json({ error: 'not found' }, 404);
  });

  app.post('/api/folders/:id/reveal', async (c) => {
    const filePath = folders.revealPath(decodeURIComponent(c.req.param('id')));
    if (!filePath) return c.json({ error: 'not found' }, 404);
    revealInFinder(filePath);
    return c.json({ ok: true });
  });

  app.patch('/api/chats/:id/folder', async (c) => {
    const id = chatId(c);
    const body = await c.req.json();
    const conv = conversations.moveToFolder(id, body.folderId ?? null);
    return conv ? c.json(conv) : c.json({ error: 'not found' }, 404);
  });
}
