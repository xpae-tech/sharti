import type { ServeOptions } from './types.js';

const TOGGLE_FLAGS: Array<[keyof ServeOptions, string]> = [
  ['persistentCache', '--persistent-cache'],
  ['noWebui', '--no-webui'],
  ['announceServedName', '--announce-served-name'],
  ['disableAne', '--disable-ane'],
  ['allowIdleSleep', '--allow-idle-sleep'],
  ['languageOnly', '--language-only'],
  ['offline', '--offline'],
];

const VALUE_FLAGS: Array<[keyof ServeOptions, string]> = [
  ['port', '--port'],
  ['host', '--host'],
  ['maxMemory', '--max-memory'],
  ['maxContext', '--max-context'],
  ['pleMemory', '--ple-memory'],
  ['expertMemory', '--expert-memory'],
  ['sparseKvMemory', '--sparse-kv-memory'],
  ['kvFormat', '--kv-format'],
  ['stateFormat', '--state-format'],
  ['idleRelease', '--idle-release'],
  ['maxCacheDisk', '--max-cache-disk'],
  ['maxCacheDiskWrites', '--max-cache-disk-writes'],
  ['cacheDir', '--cache-dir'],
  ['defaultReasoningEffort', '--default-reasoning-effort'],
  ['thinkingTokenBudget', '--thinking-token-budget'],
  ['thinkingEndText', '--thinking-end-text'],
  ['maxRequestSize', '--max-request-size'],
  ['maxImagePixels', '--max-image-pixels'],
  ['requestTimeout', '--request-timeout'],
  ['queueSize', '--queue-size'],
  ['decodeShare', '--decode-share'],
  ['verifyRows', '--verify-rows'],
  ['modelDir', '--model-dir'],
  ['mmproj', '--mmproj'],
  ['draftModel', '--draft-model'],
];

const LIST_FLAGS: Array<[keyof ServeOptions, string]> = [
  ['allowedHost', '--allowed-host'],
  ['allowedOrigin', '--allowed-origin'],
  ['servedModelName', '--served-model-name'],
];

/** Options that depend on another option; a set value is ignored when the
 *  combination would make the runtime reject the command line. */
function applies(key: keyof ServeOptions, opt: ServeOptions): boolean {
  const cacheOff = String(opt.maxCacheDisk ?? '') === '0';
  if (key === 'maxCacheDiskWrites' || key === 'persistentCache') return !cacheOff;
  if (key === 'cacheDir') {
    const persistent = isOn(opt.persistentCache);
    return !cacheOff && persistent;
  }
  if (key === 'announceServedName') return Boolean(opt.servedModelName);
  return true;
}

const isOn = (value: unknown): boolean => value === true || value === 'true';

/**
 * Builds the `launcher.py serve` argument list for a model and the launch
 * options. The API key is intentionally absent: it travels in the server's
 * environment, never its command line.
 */
export function buildServeArgs(model: string, opt: ServeOptions): string[] {
  const args = ['serve', '--model', model];

  for (const [key, flag] of TOGGLE_FLAGS) {
    if (applies(key, opt) && isOn(opt[key])) args.push(flag);
  }

  for (const [key, flag] of VALUE_FLAGS) {
    const value = opt[key];
    if (!applies(key, opt)) continue;
    if (value == null || value === '' || typeof value === 'boolean') continue;
    args.push(flag, String(value));
  }

  for (const [key, flag] of LIST_FLAGS) {
    const value = opt[key];
    if (value == null || value === '' || typeof value === 'boolean') continue;
    for (const item of String(value).split(/[,\s]+/).filter(Boolean)) {
      args.push(flag, item);
    }
  }

  return args;
}
