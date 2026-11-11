// Chat session helpers: id generation, conversation creation, persistence and
// list ordering. Kept separate from the agent loop so persistence concerns do
// not leak into streaming code.

import { S, currentConv, activeServiceName } from '../../core/state.js';
import { api } from '../../core/api.js';
import type { ChatMessage, Conversation } from '../../types';

export function uid(): string {
  try { return crypto.randomUUID(); }
  catch { return 'm-' + Date.now() + '-' + Math.random().toString(36).slice(2); }
}

/** Returns the open conversation, creating and registering a new one if needed. */
export async function ensureConversation(): Promise<Conversation> {
  let conv = currentConv();
  if (!conv) {
    const id = uid();
    let created: Conversation;
    try {
      created = await api('POST', '/api/chats', { id, name: '' });
    } catch {
      const now = Date.now();
      created = {
        id, name: '', createdAt: now, updatedAt: now,
        tokenCount: 0, userLastMessagedAt: null, assistantLastMessagedAt: null,
        messages: [], files: [],
      };
    }
    conv = created;
    S.convs.set(id, conv);
    S.currentId = id;
  }
  return conv;
}

/** Fresh live assistant placeholder for a new turn. */
export function createAssistantMessage(): ChatMessage {
  return {
    id: uid(), role: 'assistant', parts: [], ts: Date.now(),
    reasoning: '', live: true,
    model: S.state?.model ?? undefined, service: activeServiceName(),
    threadSegments: [],
  } as ChatMessage;
}

/** Persist a conversation and mirror the summary into the sidebar list. */
export async function persistConversation(conv: Conversation): Promise<void> {
  conv.updatedAt = Date.now();
  try {
    await api('PUT', `/api/chats/${encodeURIComponent(conv.id)}`, { name: conv.name, messages: conv.messages, tokenCount: conv.tokenCount });
  } catch (e) { console.warn('persist', e); }
  const i = S.chats.findIndex((c) => c.id === conv.id);
  const folderId = i >= 0 ? S.chats[i].folderId : null;
  const summ = { id: conv.id, name: conv.name, updatedAt: conv.updatedAt, tokenCount: conv.tokenCount, folderId };
  if (i >= 0) S.chats[i] = summ; else S.chats.unshift(summ);
  S.chats.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Move an existing conversation to the top of the sidebar list. */
export function bumpConversationOrder(conv: Conversation): void {
  conv.updatedAt = Date.now();
  const i = S.chats.findIndex((c) => c.id === conv.id);
  if (i >= 0) {
    const folderId = S.chats[i].folderId;
    S.chats.splice(i, 1);
    S.chats.unshift({ id: conv.id, name: conv.name, updatedAt: conv.updatedAt, tokenCount: conv.tokenCount, folderId });
  }
}
