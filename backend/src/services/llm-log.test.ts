import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendLlmLog,
  llmLogFileName,
  resolveLlmLogPath,
  snapshotHeaders,
  type LlmLogEntry,
} from './llm-log.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharti-llm-log-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function entry(chatId: string, responseBody: string): LlmLogEntry {
  return {
    id: `${chatId}-${Math.random().toString(36).slice(2)}`,
    chatId,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:00:01.000Z',
    durationMs: 1000,
    target: 'engine',
    request: {
      method: 'POST',
      url: 'http://127.0.0.1:8000/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      body: { model: 'm', messages: [{ role: 'user', content: 'hi' }] },
    },
    response: {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: responseBody,
      complete: true,
    },
  };
}

describe('llm-log', () => {
  it('builds safe log file names from chat ids', () => {
    expect(llmLogFileName('c1')).toBe('log_c1.json');
    expect(llmLogFileName('../../etc/passwd')).toBe('log_etcpasswd.json');
    expect(llmLogFileName('')).toBe('log_chat.json');
  });

  it('redacts credential headers', () => {
    const headers = new Headers({
      authorization: 'Bearer secret',
      'content-type': 'application/json',
      'x-api-key': 'key',
    });
    expect(snapshotHeaders(headers)).toEqual({
      authorization: '[redacted]',
      'content-type': 'application/json',
      'x-api-key': '[redacted]',
    });
  });

  it('appends entries to a valid JSON array', () => {
    appendLlmLog(dir, 'c1', entry('c1', 'one'));
    appendLlmLog(dir, 'c1', entry('c1', 'two'));

    const file = path.join(dir, 'log_c1.json');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as LlmLogEntry[];
    expect(parsed).toHaveLength(2);
    expect(parsed[0].response?.body).toBe('one');
    expect(parsed[1].response?.body).toBe('two');
  });

  it('keeps one file per chat id regardless of the chat name', () => {
    appendLlmLog(dir, 'c1', entry('c1', 'before'));
    const resolved = resolveLlmLogPath(dir, 'c1');

    expect(path.basename(resolved)).toBe('log_c1.json');
    appendLlmLog(dir, 'c1', entry('c1', 'after'));

    const logs = fs.readdirSync(dir).filter((name) => name.startsWith('log_'));
    expect(logs).toEqual(['log_c1.json']);
    const parsed = JSON.parse(fs.readFileSync(resolved, 'utf8')) as LlmLogEntry[];
    expect(parsed.map((e) => e.response?.body)).toEqual(['before', 'after']);
  });

  it('preserves a malformed log instead of deleting it', () => {
    const file = path.join(dir, 'log_broken.json');
    fs.writeFileSync(file, '{not json');

    appendLlmLog(dir, 'broken', entry('c1', 'fresh'));

    const corrupt = fs.readdirSync(dir).find((name) => name.startsWith('log_broken.json.corrupt-'));
    expect(corrupt).toBeDefined();
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as LlmLogEntry[];
    expect(parsed).toHaveLength(1);
  });
});
