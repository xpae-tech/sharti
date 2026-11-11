import { describe, expect, it } from 'vitest';
import { computeArgsDisplay, parseToolArgsInput } from './segments.js';

describe('computeArgsDisplay', () => {
  it('prefers streaming raw arguments', () => {
    expect(computeArgsDisplay({
      kind: 'tool', serverId: 's', toolName: 't', rawArgs: '{"a":',
      arguments: { a: 1 }, result: '', isError: false,
    })).toBe('{"a":');
  });

  it('pretty-prints parsed arguments when no raw text is available', () => {
    expect(computeArgsDisplay({
      kind: 'tool', serverId: 's', toolName: 't',
      arguments: { a: 1 }, result: '', isError: false,
    })).toBe('{\n  "a": 1\n}');
  });

  it('returns an empty string for an empty argument object', () => {
    expect(computeArgsDisplay({
      kind: 'tool', serverId: 's', toolName: 't',
      arguments: {}, result: '', isError: false,
    })).toBe('');
  });
});

describe('parseToolArgsInput', () => {
  it('parses object JSON and treats blank input as an empty object', () => {
    expect(parseToolArgsInput('{"path":"/a"}')).toEqual({ path: '/a' });
    expect(parseToolArgsInput('   ')).toEqual({});
  });

  it('rejects invalid JSON, arrays and primitives', () => {
    expect(parseToolArgsInput('{oops')).toBeNull();
    expect(parseToolArgsInput('[1,2]')).toBeNull();
    expect(parseToolArgsInput('1')).toBeNull();
    expect(parseToolArgsInput('null')).toBeNull();
  });
});
