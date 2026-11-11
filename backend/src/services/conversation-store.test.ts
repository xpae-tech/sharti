import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConversationStore } from './conversation-store.js';
import { FolderStore } from './folder-store.js';
import type { ChatMessage } from '../domain/types.js';

let root: string;
let chatsDir: string;
let foldersDir: string;
let store: ConversationStore;
let folders: FolderStore;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sharti-chats-'));
  chatsDir = path.join(root, 'chats');
  foldersDir = path.join(root, 'folders');
  store = new ConversationStore(chatsDir, foldersDir);
  folders = new FolderStore(foldersDir);
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const message = (id: string, role: 'user' | 'assistant', text: string): ChatMessage => ({
  id,
  role,
  parts: [{ type: 'text', text }],
  ts: Date.now(),
});

describe('ConversationStore', () => {
  it('creates and reads chats from the in-memory index', () => {
    const created = store.create('c1', 'First');
    expect(created.id).toBe('c1');
    expect(store.get('c1')?.name).toBe('First');
    expect(store.list()).toHaveLength(1);
  });

  it('updates messages and last-message timestamps', () => {
    store.create('c1', 'First');
    const updated = store.update('c1', [message('m1', 'user', 'hi')], 'Renamed');
    expect(updated.name).toBe('Renamed');
    expect(updated.userLastMessagedAt).not.toBeNull();
    expect(store.get('c1')?.messages[0].parts[0]).toEqual({ type: 'text', text: 'hi' });
  });

  it('persists the conversation context token count', () => {
    store.create('c1', 'First');
    const updated = store.update('c1', [message('m1', 'assistant', 'done')], undefined, 12_345);
    expect(updated.tokenCount).toBe(12_345);
    expect(store.get('c1')?.tokenCount).toBe(12_345);
  });

  it('keeps tokenCount and drops retired fields from old chat files', () => {
    const dir = path.join(chatsDir, 'c1');
    fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'c1.json'), JSON.stringify({
      id: 'c1',
      name: 'Legacy',
      pinned: true,
      systemPrompt: 'old prompt',
      tokenCount: 42,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      files: [],
    }));

    const loaded = new ConversationStore(chatsDir, foldersDir).get('c1');
    expect(loaded?.tokenCount).toBe(42);
    const raw = loaded as unknown as Record<string, unknown>;
    expect(raw).not.toHaveProperty('pinned');
    expect(raw).not.toHaveProperty('systemPrompt');
  });

  it('patches the conversation name', () => {
    store.create('c1', 'First');
    expect(store.patchName('c1', 'Second')?.name).toBe('Second');
  });

  it('moves chats between the general zone and folders', () => {
    store.create('c1', 'First');
    const folder = folders.create('f1', 'Work');
    expect(store.moveToFolder('c1', folder.id)?.folderId).toBe('f1');
    expect(store.chatIdsInFolder('f1')).toEqual(['c1']);
    expect(store.list()[0].folderId).toBe('f1');
    expect(store.moveToFolder('c1', null)?.folderId).toBeNull();
    expect(store.chatIdsInFolder('f1')).toEqual([]);
  });

  it('refuses to move into a missing folder', () => {
    store.create('c1', 'First');
    expect(store.moveToFolder('c1', 'missing')).toBeNull();
  });

  it('stores and retrieves uploaded files', () => {
    store.create('c1', 'First');
    const meta = store.uploadFile('c1', Buffer.from('image'), 'photo.png', 'image/png');
    expect(store.listFiles('c1')).toHaveLength(1);
    const file = store.getFileBuffer('c1', meta.fileName);
    expect(file?.mimeType).toBe('image/png');
    expect(file?.buffer.toString()).toBe('image');
  });

  it('deletes chats and their files', () => {
    store.create('c1', 'First');
    store.uploadFile('c1', Buffer.from('x'), 'a.txt', 'text/plain');
    expect(store.delete('c1')).toBe(true);
    expect(store.get('c1')).toBeNull();
    expect(fs.existsSync(path.join(chatsDir, 'c1'))).toBe(false);
  });

  it('writes LLM traffic logs into the chat files directory', () => {
    store.create('c1', 'First chat');
    const entry = {
      id: 'log-1',
      chatId: 'c1',
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:00:01.000Z',
      durationMs: 1000,
      target: 'external' as const,
      request: { method: 'POST', url: 'https://example.com/v1/chat/completions', headers: {}, body: {} },
      response: { status: 200, headers: {}, body: 'data: [DONE]\n\n', complete: true },
    };

    const logPath = store.appendLlmLog('c1', entry);
    expect(logPath).toBe(path.join(chatsDir, 'c1', 'files', 'log_c1.json'));
    const parsed = JSON.parse(fs.readFileSync(logPath!, 'utf8')) as unknown[];
    expect(parsed).toHaveLength(1);
    expect(store.appendLlmLog('missing', entry)).toBeNull();
  });

  it('marks empty assistant replies as interrupted', () => {
    store.create('c1', 'First');
    store.update('c1', [message('m1', 'assistant', '')]);
    expect(store.get('c1')?.messages[0].error).toBe('The reply was interrupted.');
  });

  it('stores reasoning once in thread segments and derives it on read', () => {
    store.create('c1', 'First');
    const assistant: ChatMessage = {
      id: 'a1',
      role: 'assistant',
      parts: [{ type: 'text', text: 'answer' }],
      ts: Date.now(),
      reasoning: 'thought',
      threadSegments: [{ kind: 'reasoning', text: 'thought' }],
    };

    store.update('c1', [assistant]);
    const file = path.join(chatsDir, 'c1', 'c1.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(raw.messages[0]).not.toHaveProperty('reasoning');
    expect(store.get('c1')?.messages[0].reasoning).toBe('thought');
  });

  it('keeps the legacy reasoning field when a message has no segments', () => {
    store.create('c1', 'First');
    store.update('c1', [{ ...message('a1', 'assistant', ''), reasoning: 'legacy thought' }]);

    const file = path.join(chatsDir, 'c1', 'c1.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      messages: Array<Record<string, unknown>>;
    };
    expect(raw.messages[0].reasoning).toBe('legacy thought');
    expect(store.get('c1')?.messages[0].reasoning).toBe('legacy thought');
  });
});

describe('FolderStore', () => {
  it('creates, renames and deletes folders', () => {
    const created = folders.create('f1', 'Work');
    expect(created.name).toBe('Work');
    expect(folders.list()).toHaveLength(1);
    expect(folders.patchName('f1', 'Home')?.name).toBe('Home');
    expect(folders.delete('f1')).toBe(true);
    expect(folders.get('f1')).toBeNull();
  });

  it('returns null for unknown folders', () => {
    expect(folders.get('missing')).toBeNull();
    expect(folders.patchName('missing', 'x')).toBeNull();
    expect(folders.delete('missing')).toBe(false);
  });
});
