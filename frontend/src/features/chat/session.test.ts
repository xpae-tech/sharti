import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S } from '../../core/state.js';
import {
  bumpConversationOrder,
  createAssistantMessage,
  ensureConversation,
  persistConversation,
  uid,
} from './session.js';
import type { Conversation } from '../../types';

function conversation(id: string, updatedAt = 1): Conversation {
  return {
    id, name: id, createdAt: 1, updatedAt, tokenCount: 0,
    userLastMessagedAt: null, assistantLastMessagedAt: null,
    messages: [], files: [],
  };
}

beforeEach(() => {
  S.chats = [];
  S.convs = new Map();
  S.currentId = null;
  S.state = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('session helpers', () => {
  it('generates unique non-empty ids', () => {
    const a = uid();
    const b = uid();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it('creates a live assistant placeholder for the active service', () => {
    S.state = {
      phase: 'ready', step: '', serving: 'running', model: 'org/model',
      modelDisplayName: 'Model', next: null, since: null, stepSince: null,
      port: 8000, context: null, acceptsImages: true, reasoning: null,
      memBytes: null, failMessage: null, status: '', markLook: 'on',
      apiAddress: '', uptimeSec: 1,
    };
    const msg = createAssistantMessage();
    expect(msg.role).toBe('assistant');
    expect(msg.live).toBe(true);
    expect(msg.model).toBe('org/model');
    expect(msg.threadSegments).toEqual([]);
  });

  it('creates and registers a conversation when none is open', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      return new Response(JSON.stringify(conversation(body.id)), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }));

    const conv = await ensureConversation();
    expect(conv.id).toBeTruthy();
    expect(S.currentId).toBe(conv.id);
    expect(S.convs.get(conv.id)?.id).toBe(conv.id);
  });

  it('persists the summary and keeps the sidebar newest-first', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));
    S.chats = [
      { id: 'old', name: 'Old', updatedAt: 1, tokenCount: 0, folderId: null },
      { id: 'conv', name: 'Chat', updatedAt: 2, tokenCount: 0, folderId: 'f1' },
    ];

    const conv = conversation('conv');
    conv.tokenCount = 42;
    await persistConversation(conv);

    expect(S.chats[0]).toMatchObject({ id: 'conv', tokenCount: 42, folderId: 'f1' });
    expect(S.chats[1].id).toBe('old');
  });

  it('bumps an existing conversation to the top', () => {
    S.chats = [
      { id: 'a', name: 'A', updatedAt: 10, tokenCount: 0, folderId: null },
      { id: 'b', name: 'B', updatedAt: 5, tokenCount: 0, folderId: null },
    ];
    bumpConversationOrder(conversation('b'));
    expect(S.chats.map((c) => c.id)).toEqual(['b', 'a']);
  });
});
