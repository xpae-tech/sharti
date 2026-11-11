import { describe, expect, it } from 'vitest';
import { sameImages, sameMessage, sameThreadSegments } from './diff.js';
import type { ThreadSegment, TranscriptMessage } from '../types';

function message(overrides: Partial<TranscriptMessage> = {}): TranscriptMessage {
  return {
    id: 'm1',
    role: 'assistant',
    text: 'hello',
    reasoning: '',
    images: [],
    threadSegments: [],
    ...overrides,
  };
}

function tool(overrides: Record<string, unknown> = {}): ThreadSegment {
  return {
    kind: 'tool',
    serverId: 'sharti-agent',
    toolName: 'read_file',
    arguments: { path: '/a' },
    result: 'ok',
    isError: false,
    toolCallId: 'call-1',
    ...overrides,
  } as ThreadSegment;
}

describe('sameMessage', () => {
  it('treats null and changed fields as different', () => {
    expect(sameMessage(null, message())).toBe(false);
    expect(sameMessage(message(), message())).toBe(true);
    expect(sameMessage(message(), message({ text: 'other' }))).toBe(false);
    expect(sameMessage(message(), message({ live: true }))).toBe(false);
  });

  it('compares rendering metadata and images', () => {
    expect(sameMessage(message(), message({ details: '1.2s' }))).toBe(false);
    expect(sameMessage(message(), message({ service: 'GPT-4o' }))).toBe(false);
    expect(sameMessage(message({ images: ['a'] }), message({ images: ['b'] }))).toBe(false);
  });
});

describe('sameThreadSegments', () => {
  it('compares reasoning text, stats and content start', () => {
    const a = message({ threadSegments: [{ kind: 'reasoning', text: 'think', stats: '1s' }] });
    expect(sameThreadSegments(a, a)).toBe(true);
    expect(sameThreadSegments(a, message({ threadSegments: [{ kind: 'reasoning', text: 'think' }] }))).toBe(false);
    expect(sameThreadSegments(a, message({ threadSegments: [{ kind: 'reasoning', text: 'think', stats: '1s', contentStarted: true }] }))).toBe(false);
  });

  it('compares content text and segment order', () => {
    const a = message({ threadSegments: [{ kind: 'content', text: 'a' }] });
    const b = message({ threadSegments: [{ kind: 'content', text: 'b' }] });
    expect(sameThreadSegments(a, b)).toBe(false);
    expect(sameThreadSegments(a, message({ threadSegments: [{ kind: 'tool', serverId: 's', toolName: 't', arguments: {}, result: '', isError: false }] }))).toBe(false);
  });

  it('detects tool identity, approval and argument changes', () => {
    expect(sameThreadSegments(message({ threadSegments: [tool()] }), message({ threadSegments: [tool()] }))).toBe(true);
    expect(sameThreadSegments(message({ threadSegments: [tool()] }), message({ threadSegments: [tool({ approval: 'approved' })] }))).toBe(false);
    expect(sameThreadSegments(message({ threadSegments: [tool()] }), message({ threadSegments: [tool({ rawArgs: '{"path":"/b"}' })] }))).toBe(false);
    expect(sameThreadSegments(message({ threadSegments: [tool()] }), message({ threadSegments: [tool({ result: 'fail', isError: true })] }))).toBe(false);
  });
});

describe('sameImages', () => {
  it('compares image lists by value and length', () => {
    expect(sameImages(message({ images: ['a'] }), message({ images: ['a'] }))).toBe(true);
    expect(sameImages(message({ images: ['a'] }), message({ images: ['a', 'b'] }))).toBe(false);
    expect(sameImages(message({ images: ['a'] }), message({ images: ['b'] }))).toBe(false);
  });
});
