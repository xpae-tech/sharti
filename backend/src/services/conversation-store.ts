import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Conversation, ChatMessage, ChatFileMeta, Part, ImagePart } from '../domain/types.js';
import { getMessageReasoning, getMessageText } from '../domain/types.js';
import { sanitizeId } from '../../../shared/ids.js';
import { writeJsonAtomic } from '../infra/fs-atomic.js';
import { isDirectory } from '../infra/paths.js';
import { appendLlmLog as appendLlmLogEntry, type LlmLogEntry } from './llm-log.js';

interface CacheEntry {
  conv: Conversation;
  dir: string;
  folderId: string | null;
}

/**
 * FS-backed conversation store with an in-memory index.
 *
 * A chat lives in exactly ONE physical directory. Where that directory sits
 * determines its folder membership — there is NO folderId field written into
 * the chat's own JSON.
 *
 * Layout:
 *   <chatsDir>/<uuid>/<uuid>.json          — ungrouped ("general") chat
 *   <chatsDir>/<uuid>/files/               — its uploads
 *   <foldersDir>/<fid>/<uuid>/<uuid>.json  — chat physically moved INTO folder <fid>
 *
 * Moving a chat into/out of a folder is a literal directory move (fs.rename).
 */
export class ConversationStore {
  private readonly chatsDir: string;
  private readonly foldersDir: string;
  private readonly cache = new Map<string, CacheEntry>();
  private loaded = false;

  constructor(chatsDir: string, foldersDir: string) {
    this.chatsDir = chatsDir;
    this.foldersDir = foldersDir;
    fs.mkdirSync(this.chatsDir, { recursive: true });
    fs.mkdirSync(this.foldersDir, { recursive: true });
    this.migrateLegacy();
  }

  // ── Location helpers ──────────────────────────────────────────────────────

  private generalRoot(): string { return this.chatsDir; }
  private folderRoot(fid: string): string { return path.join(this.foldersDir, sanitizeId(fid)); }

  /** Every root that can host chats: the general dir + each folder dir. */
  private allRoots(): string[] {
    const roots = [this.generalRoot()];
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(this.foldersDir, { withFileTypes: true }); } catch { /* noop */ }
    for (const e of ents) if (e.isDirectory()) roots.push(path.join(this.foldersDir, e.name));
    return roots;
  }

  private key(id: string): string {
    return sanitizeId(id);
  }

  /** Scans the filesystem once, then serves reads from the in-memory index. */
  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    for (const root of this.allRoots()) {
      const folderId = root === this.generalRoot() ? null : path.basename(root);
      let subs: fs.Dirent[] = [];
      try { subs = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const s of subs) {
        if (!s.isDirectory()) continue;
        const dir = path.join(root, s.name);
        const conv = this.readFromDir(dir);
        if (!conv) continue;
        if (!conv.id) conv.id = s.name;
        this.cache.set(this.key(conv.id), { conv, dir, folderId });
      }
    }
  }

  private locate(id: string): CacheEntry | null {
    this.ensureLoaded();
    return this.cache.get(this.key(id)) ?? null;
  }

  private readFromDir(dir: string): Conversation | null {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, `${path.basename(dir)}.json`), 'utf8')) as Record<string, unknown>;
      // Retired fields from older chat files. Drop them during load so the next
      // write does not persist them forever.
      delete raw.pinned;
      delete raw.systemPrompt;
      if (typeof raw.tokenCount !== 'number') raw.tokenCount = 0;
      const conv = raw as unknown as Conversation;
      // Reasoning segments are canonical. Older files also carried a duplicate
      // message-level field; derive it for the client and drop it on the next
      // write so the two copies cannot drift apart.
      for (const m of conv.messages ?? []) {
        if (m.threadSegments?.some((s) => s.kind === 'reasoning' && s.text)) {
          m.reasoning = getMessageReasoning(m);
        }
      }
      return conv;
    } catch {
      return null;
    }
  }

  private writeToDir(dir: string, conv: Conversation): void {
    conv.updatedAt = Date.now();
    // Never persist a folderId — membership is implied by location.
    const { folderId: _omit, ...rest } = conv as Conversation & { folderId?: unknown };
    // The reasoning segment is the only stored copy. Strip the derived
    // message-level field whenever segments carry reasoning; legacy messages
    // without segments keep their field.
    const messages = rest.messages.map((m) => {
      if (!m.threadSegments?.some((s) => s.kind === 'reasoning' && s.text)) return m;
      const { reasoning: _reasoning, ...message } = m;
      return message as ChatMessage;
    });
    writeJsonAtomic(path.join(dir, `${sanitizeId(conv.id)}.json`), { ...rest, messages });
  }

  // ── Query ─────────────────────────────────────────────────────────────────

  list(): Conversation[] {
    this.ensureLoaded();
    return [...this.cache.values()]
      .map((e) => annotate(markInterrupted(e.conv), e.folderId))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id: string): Conversation | null {
    const entry = this.locate(id);
    if (!entry) return null;
    return annotate(markInterrupted(entry.conv), entry.folderId);
  }

  // ── Mutate ────────────────────────────────────────────────────────────────

  create(id: string, name: string): Conversation {
    const now = Date.now();
    const conv: Conversation = {
      id, name, createdAt: now, updatedAt: now, tokenCount: 0,
      userLastMessagedAt: null, assistantLastMessagedAt: null,
      messages: [], files: [],
    };
    const dir = path.join(this.generalRoot(), sanitizeId(id));
    fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
    this.writeToDir(dir, conv);
    this.cache.set(this.key(id), { conv, dir, folderId: null });
    return conv;
  }

  update(id: string, messages: ChatMessage[], name?: string, tokenCount?: number): Conversation {
    const entry = this.locate(id);
    if (!entry) throw new Error(`conversation ${id} not found`);
    const prev = entry.conv;
    const now = Date.now();
    const conv: Conversation = {
      id,
      name: name ?? prev.name ?? '',
      createdAt: prev.createdAt ?? now,
      updatedAt: now,
      tokenCount: tokenCount ?? prev.tokenCount ?? 0,
      userLastMessagedAt: lastByRole(messages, 'user') ?? prev.userLastMessagedAt ?? null,
      assistantLastMessagedAt: lastByRole(messages, 'assistant') ?? prev.assistantLastMessagedAt ?? null,
      messages,
      files: prev.files ?? [],
    };
    this.writeToDir(entry.dir, conv);
    entry.conv = conv;
    return annotate(conv, entry.folderId);
  }

  patchName(id: string, name: string): Conversation | null {
    const entry = this.locate(id);
    if (!entry) return null;
    entry.conv.name = name;
    this.writeToDir(entry.dir, entry.conv);
    return annotate(entry.conv, entry.folderId);
  }

  /** Physically move a chat directory into a folder (or back to general). */
  moveToFolder(id: string, targetFolderId: string | null): Conversation | null {
    const entry = this.locate(id);
    if (!entry) return null;
    if (entry.folderId === targetFolderId) return annotate(entry.conv, entry.folderId);

    if (targetFolderId) {
      if (!isDirectory(this.folderRoot(targetFolderId))) return null;
    }
    const targetRoot = targetFolderId ? this.folderRoot(targetFolderId) : this.generalRoot();
    const dst = path.join(targetRoot, sanitizeId(id));
    if (isDirectory(dst)) return null; // safety: refuse to overwrite
    fs.mkdirSync(targetRoot, { recursive: true });
    fs.renameSync(entry.dir, dst);
    entry.dir = dst;
    entry.folderId = targetFolderId;
    this.writeToDir(dst, entry.conv);
    return annotate(entry.conv, targetFolderId);
  }

  delete(id: string): boolean {
    const entry = this.locate(id);
    if (!entry) return false;
    fs.rmSync(entry.dir, { recursive: true, force: true });
    this.cache.delete(this.key(id));
    return true;
  }

  revealPath(id: string): string | null {
    const entry = this.locate(id);
    if (!entry) return null;
    const p = path.join(entry.dir, `${sanitizeId(id)}.json`);
    return fs.existsSync(p) ? p : null;
  }

  /** Chat IDs sitting directly inside a given folder. */
  chatIdsInFolder(folderId: string): string[] {
    this.ensureLoaded();
    const out: string[] = [];
    for (const entry of this.cache.values()) {
      if (entry.folderId === folderId) out.push(entry.conv.id);
    }
    return out;
  }

  // ── File operations ───────────────────────────────────────────────────────

  uploadFile(chatId: string, buffer: Buffer, originalName: string, mimeType: string): ChatFileMeta {
    const entry = this.locate(chatId);
    if (!entry) throw new Error(`conversation ${chatId} not found`);
    const filesDir = path.join(entry.dir, 'files');
    fs.mkdirSync(filesDir, { recursive: true });

    const ext = path.extname(originalName) || mimeExt(mimeType);
    const fileName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(filesDir, fileName), buffer);

    const resolvedMime = mimeType || guessMime(originalName);
    const meta: ChatFileMeta = { fileName, originalName, mimeType: resolvedMime, sizeBytes: buffer.length, uploadedAt: Date.now() };
    entry.conv.files.push(meta);
    this.writeToDir(entry.dir, entry.conv);
    return meta;
  }

  getFileBuffer(chatId: string, fileName: string): { buffer: Buffer; mimeType: string } | null {
    const entry = this.locate(chatId);
    if (!entry) return null;
    const fp = path.join(entry.dir, 'files', sanitizeFileName(fileName));
    if (!fs.existsSync(fp)) return null;
    const buffer = fs.readFileSync(fp);
    const meta = entry.conv.files.find((f) => f.fileName === fileName);
    return { buffer, mimeType: meta?.mimeType ?? guessMime(fileName) };
  }

  listFiles(chatId: string): ChatFileMeta[] {
    const entry = this.locate(chatId);
    return entry ? entry.conv.files : [];
  }

  // ── LLM traffic log ───────────────────────────────────────────────────────

  /**
   * Appends one request/response pair to the chat's log file:
   *   <chatDir>/files/log_<chat-id>.json
   * Returns the log path, or null when the chat does not exist.
   */
  appendLlmLog(chatId: string, entry: LlmLogEntry): string | null {
    const located = this.locate(chatId);
    if (!located) return null;
    return appendLlmLogEntry(path.join(located.dir, 'files'), located.conv.id, entry);
  }

  // ── Legacy migration ──────────────────────────────────────────────────────

  /** Migrate old-style flat .json files in the general dir into per-directory form. */
  private migrateLegacy(): void {
    let entries: string[] = [];
    try { entries = fs.readdirSync(this.generalRoot()); } catch { return; }
    for (const fname of entries) {
      if (!fname.endsWith('.json')) continue;
      const fullPath = path.join(this.generalRoot(), fname);
      if (!fs.statSync(fullPath).isFile()) continue;

      let legacy: Record<string, unknown>;
      try { legacy = JSON.parse(fs.readFileSync(fullPath, 'utf8')); } catch { continue; }

      const id = (legacy.id as string) ?? fname.replace(/\.json$/, '');
      const destDir = path.join(this.generalRoot(), sanitizeId(id));
      if (isDirectory(destDir)) {
        try { fs.unlinkSync(fullPath); } catch { /* noop */ }
        continue;
      }

      const now = Date.now();
      const legacyMessages = (legacy.messages ?? []) as Array<Record<string, unknown>>;
      const messages: ChatMessage[] = legacyMessages.map((m) => {
        const parts: Part[] = [];
        if (m.text) parts.push({ type: 'text', text: m.text as string });
        if (Array.isArray(m.images)) {
          for (const imgUrl of m.images as string[]) {
            const fileName = imageDataToFilename(imgUrl);
            parts.push({ type: 'image', fileName, mimeType: 'image/png' });
          }
        }
        return {
          id: (m.id as string) ?? crypto.randomUUID(),
          role: m.role as 'user' | 'assistant',
          parts, ts: (m.ts as number) ?? (m.timestamp as number) ?? now,
          reasoning: m.reasoning as string | undefined,
          error: m.error as string | undefined,
          stopped: m.stopped as boolean | undefined,
          model: m.model as string | undefined,
          service: m.service as string | undefined,
          tps: m.tps as number | null | undefined,
          input: m.input as number | null | undefined,
          output: m.output as number | null | undefined,
          duration: m.duration as number | null | undefined,
          reasoningTokens: m.reasoningTokens as number | null | undefined,
        };
      });

      const filesDir = path.join(destDir, 'files');
      fs.mkdirSync(filesDir, { recursive: true });
      const files: ChatFileMeta[] = [];
      for (const m of messages) {
        for (const p of m.parts) {
          if (p.type === 'image') {
            const imgPart = p as ImagePart;
            const origMsg = legacyMessages.find((om) => om.id === m.id);
            const origImages = (origMsg?.images ?? []) as string[];
            const idx = m.parts.filter((pp) => pp.type === 'image').indexOf(imgPart);
            const dataUrl = origImages[idx];
            if (dataUrl && dataUrl.startsWith('data:')) {
              const base64 = dataUrl.split(',')[1];
              if (base64) {
                const buf = Buffer.from(base64, 'base64');
                fs.writeFileSync(path.join(filesDir, imgPart.fileName), buf);
                const mimeMatch = dataUrl.match(/^data:(.+?);/);
                files.push({ fileName: imgPart.fileName, originalName: imgPart.fileName, mimeType: mimeMatch?.[1] ?? 'image/png', sizeBytes: buf.length, uploadedAt: now });
              }
            }
          }
        }
      }

      const conv: Conversation = {
        id, name: (legacy.title as string) ?? (legacy.name as string) ?? '',
        createdAt: (legacy.createdAt as number) ?? (legacy.updated as number) ?? now, updatedAt: now, tokenCount: 0,
        userLastMessagedAt: null, assistantLastMessagedAt: null, messages, files,
      };
      conv.userLastMessagedAt = lastByRole(messages, 'user');
      conv.assistantLastMessagedAt = lastByRole(messages, 'assistant');
      this.writeToDir(destDir, conv);

      try { fs.unlinkSync(fullPath); } catch { /* noop */ }
    }
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function annotate(c: Conversation, folderId: string | null): Conversation {
  return { ...c, folderId };
}

function sanitizeFileName(name: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function lastByRole(messages: ChatMessage[], role: string): number | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === role) return messages[i].ts;
  }
  return null;
}

function markInterrupted(c: Conversation): Conversation {
  for (const m of c.messages ?? []) {
    if (m.role === 'assistant' && !getMessageText(m) && !getMessageReasoning(m) && !m.error && m.stopped !== true) {
      m.error = 'The reply was interrupted.';
    }
  }
  return c;
}

function imageDataToFilename(dataUrl: string): string {
  const mimeMatch = dataUrl.match(/^data:(.+?);/);
  const mime = mimeMatch?.[1] ?? 'image/png';
  const ext = mimeExt(mime);
  return `mig-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${ext}`;
}

function mimeExt(mime: string): string {
  const map: Record<string, string> = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp',
    'image/gif': '.gif', 'image/bmp': '.bmp', 'image/svg+xml': '.svg',
    'application/pdf': '.pdf',
  };
  return map[mime] ?? '.bin';
}

function guessMime(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
  };
  return map[ext] ?? 'application/octet-stream';
}
