import { describe, expect, it } from 'vitest';
import { formatChatError } from './errors.js';

const ctx = {
  external: true,
  serviceName: 'GPT-4o',
  contextLimit: 128_000,
  messageCount: 3,
};

const figure = (n: number): string => `${Math.round(n / 1000)}K`;

describe('formatChatError', () => {
  it('returns the provider message for ordinary errors', () => {
    expect(formatChatError({ error: { message: 'Bad request' } }, ctx, figure)).toBe('Bad request');
    expect(formatChatError('plain failure', ctx, figure)).toBe('"plain failure"');
  });

  it('explains context overflow for a single long message', () => {
    const error = { error: { code: 'context_length_exceeded', message: 'too long' } };
    expect(formatChatError(error, { ...ctx, messageCount: 1 }, figure))
      .toBe("This message is longer than GPT-4o's 128K-token context.");
  });

  it('explains context overflow for a long conversation', () => {
    const error = { code: 'context_length_exceeded' };
    expect(formatChatError(error, ctx, figure))
      .toBe("This chat is longer than GPT-4o's 128K-token context. Start a new chat to continue.");
  });

  it('falls back to the model label and an unknown context window', () => {
    const error = { code: 'context_length_exceeded' };
    expect(formatChatError(error, { ...ctx, external: false, contextLimit: null }, figure))
      .toBe("This chat is longer than the model's context. Start a new chat to continue.");
  });
});
