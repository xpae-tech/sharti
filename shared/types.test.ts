import { describe, expect, it } from 'vitest';
import { createDefaultPrefs, getMessageReasoning, redactApiConnection, redactPrefs } from './types.js';

describe('client-safe payloads', () => {  it('redacts a connection but reports whether a key is stored', () => {
    const connection = {
      id: '1',
      name: 'Work',
      baseUrl: 'https://example.com',
      apiKey: 'secret',
      modelName: 'GPT-4o',
      modelId: 'gpt-4o',
    };

    expect(redactApiConnection(connection)).toMatchObject({
      apiKey: '',
      hasApiKey: true,
    });
    expect(redactApiConnection({ ...connection, apiKey: '' })).toMatchObject({
      apiKey: '',
      hasApiKey: false,
    });
  });

  it('removes secrets from preferences without mutating the source', () => {
    const prefs = createDefaultPrefs();
    prefs.options.apiKey = 'secret';
    prefs.apiConnections = [{
      id: '1',
      name: 'Work',
      baseUrl: 'https://example.com',
      apiKey: 'secret',
      modelName: 'GPT-4o',
      modelId: 'gpt-4o',
    }];

    const safe = redactPrefs(prefs);

    expect(safe.options.apiKey).toBeUndefined();
    expect(safe.apiConnections[0].apiKey).toBe('');
    expect(safe.apiConnections[0].hasApiKey).toBe(true);
    expect(prefs.options.apiKey).toBe('secret');
  });
});

describe('getMessageReasoning', () => {
  const message = {
    id: 'a1',
    role: 'assistant' as const,
    parts: [],
    ts: 1,
  };

  it('derives reasoning from thread segments across rounds', () => {
    expect(getMessageReasoning({
      ...message,
      reasoning: 'stale copy',
      threadSegments: [
        { kind: 'reasoning', text: 'first' },
        { kind: 'tool', serverId: 's', toolName: 't', arguments: {}, result: '', isError: false },
        { kind: 'reasoning', text: 'second' },
      ],
    })).toBe('firstsecond');
  });

  it('falls back to the legacy message-level field without segments', () => {
    expect(getMessageReasoning({ ...message, reasoning: 'legacy' })).toBe('legacy');
    expect(getMessageReasoning(message)).toBe('');
  });
});
