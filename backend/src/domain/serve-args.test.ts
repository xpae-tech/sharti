import { describe, expect, it } from 'vitest';
import { buildServeArgs } from './serve-args.js';
import type { ServeOptions } from './types.js';

describe('buildServeArgs', () => {
  it('emits every supported value flag', () => {
    const options: ServeOptions = {
      port: '8080',
      host: '0.0.0.0',
      maxMemory: '32G',
      maxContext: '128K',
      pleMemory: '2G',
      expertMemory: '16G',
      sparseKvMemory: '1200M',
      kvFormat: 'bf16',
      stateFormat: 'bf16',
      idleRelease: '30m',
      maxCacheDisk: '32G',
      maxCacheDiskWrites: '200G',
      persistentCache: true,
      cacheDir: '/tmp/cache',
      defaultReasoningEffort: 'high',
      thinkingTokenBudget: '4096',
      thinkingEndText: '</think>',
      maxRequestSize: '256M',
      maxImagePixels: '1048576',
      requestTimeout: '5m',
      queueSize: '64',
      decodeShare: '0.5',
      verifyRows: 'all',
      disableAne: true,
      allowIdleSleep: true,
      languageOnly: true,
      offline: true,
      noWebui: true,
      announceServedName: true,
      servedModelName: 'gpt-4o, another',
      allowedHost: 'mymac.local, other.local',
      allowedOrigin: 'tauri://localhost, https://example.com',
    };
    const args = buildServeArgs('org/model', options);

    expect(args.slice(0, 3)).toEqual(['serve', '--model', 'org/model']);
    for (const [flag, value] of [
      ['--port', '8080'], ['--host', '0.0.0.0'], ['--max-memory', '32G'],
      ['--max-context', '128K'], ['--ple-memory', '2G'], ['--expert-memory', '16G'],
      ['--sparse-kv-memory', '1200M'], ['--kv-format', 'bf16'], ['--state-format', 'bf16'],
      ['--idle-release', '30m'], ['--max-cache-disk', '32G'], ['--max-cache-disk-writes', '200G'],
      ['--cache-dir', '/tmp/cache'], ['--default-reasoning-effort', 'high'],
      ['--thinking-token-budget', '4096'], ['--thinking-end-text', '</think>'],
      ['--max-request-size', '256M'], ['--max-image-pixels', '1048576'],
      ['--request-timeout', '5m'], ['--queue-size', '64'], ['--decode-share', '0.5'],
      ['--verify-rows', 'all'],
    ] as const) {
      expect(args).toContain(flag);
      expect(args[args.indexOf(flag) + 1]).toBe(value);
    }
    for (const flag of ['--persistent-cache', '--no-webui', '--announce-served-name', '--disable-ane', '--allow-idle-sleep', '--language-only', '--offline']) {
      expect(args).toContain(flag);
    }
    expect(args.filter((a) => a === '--served-model-name')).toHaveLength(2);
    expect(args.filter((a) => a === '--allowed-host')).toHaveLength(2);
    expect(args.filter((a) => a === '--allowed-origin')).toHaveLength(2);
    expect(args).not.toContain('--api-key');
  });

  it('skips cache options when the SSD cache is off', () => {
    const args = buildServeArgs('org/model', {
      maxCacheDisk: '0',
      maxCacheDiskWrites: '200G',
      persistentCache: true,
      cacheDir: '/tmp/cache',
    });
    expect(args).not.toContain('--max-cache-disk-writes');
    expect(args).not.toContain('--persistent-cache');
    expect(args).not.toContain('--cache-dir');
  });

  it('requires a served name before announcing it', () => {
    expect(buildServeArgs('m', { announceServedName: true })).not.toContain('--announce-served-name');
  });

  it('does not emit false toggles or empty values', () => {
    const args = buildServeArgs('m', {
      persistentCache: false,
      host: '',
      maxContext: '',
    });
    expect(args).toEqual(['serve', '--model', 'm']);
  });
});
