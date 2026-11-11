import fs from 'node:fs';
import path from 'node:path';
import { sanitizeId } from '../../../shared/ids.js';

/** Snapshot of one request sent to an LLM provider. */
export interface LlmLogRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Parsed JSON body when possible, raw text otherwise. */
  body: unknown;
}

/** Snapshot of the provider's response. */
export interface LlmLogResponse {
  status: number;
  headers: Record<string, string>;
  /** Raw response text (SSE stream or JSON document). */
  body: string;
  /** False when the client disconnected before the upstream response ended. */
  complete: boolean;
}

/** One request/response pair stored in `log_<chat-id>.json`. */
export interface LlmLogEntry {
  id: string;
  chatId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  target: 'external' | 'engine';
  request: LlmLogRequest;
  response: LlmLogResponse | null;
  error?: string;
}

/** Header names whose values must never reach a log file. */
const SECRET_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
]);

/** Copies headers into a plain object, replacing credentials with a marker. */
export function snapshotHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = SECRET_HEADERS.has(key.toLowerCase()) ? '[redacted]' : value;
  });
  return out;
}

/** The log file name required by the logging feature. */
export function llmLogFileName(chatId: string): string {
  return `log_${sanitizeId(chatId) || 'chat'}.json`;
}

/** Resolves the chat's log file inside its `files` directory. */
export function resolveLlmLogPath(filesDir: string, chatId: string): string {
  return path.join(filesDir, llmLogFileName(chatId));
}

/** Appends one entry to the chat's log file, creating the JSON array on demand. */
export function appendLlmLog(filesDir: string, chatId: string, entry: LlmLogEntry): string {
  const filePath = resolveLlmLogPath(filesDir, chatId);
  appendJsonArrayEntry(filePath, entry);
  return filePath;
}

/**
 * Appends a value to a JSON array without re-serializing the entire document.
 * The file always stays a valid `[ ... ]` array; a malformed file is preserved
 * under a `.corrupt-<timestamp>` suffix and replaced with a fresh log.
 */
function appendJsonArrayEntry(filePath: string, entry: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const entryText = JSON.stringify(entry, null, 2);
  const indented = entryText.split('\n').map((line) => `  ${line}`).join('\n');

  let size = 0;
  try {
    size = fs.statSync(filePath).size;
  } catch {
    size = 0;
  }
  if (size === 0) {
    fs.writeFileSync(filePath, `[\n${indented}\n]`, 'utf8');
    return;
  }

  const fd = fs.openSync(filePath, 'r+');
  try {
    const tailLength = Math.min(size, 16 * 1024);
    const tail = Buffer.alloc(tailLength);
    fs.readSync(fd, tail, 0, tailLength, size - tailLength);

    let closeIndex = -1;
    for (let i = tail.length - 1; i >= 0; i--) {
      const byte = tail[i];
      if (byte === 0x5d) { // ']'
        closeIndex = i;
        break;
      }
      if (byte !== 0x20 && byte !== 0x0a && byte !== 0x0d && byte !== 0x09) break;
    }

    if (closeIndex < 0) {
      fs.closeSync(fd);
      backupCorrupt(filePath);
      fs.writeFileSync(filePath, `[\n${indented}\n]`, 'utf8');
      return;
    }

    const closeOffset = size - tailLength + closeIndex;
    let emptyArray = false;
    if (closeOffset <= 4096) {
      const head = Buffer.alloc(closeOffset);
      if (closeOffset > 0) fs.readSync(fd, head, 0, closeOffset, 0);
      emptyArray = head.toString('utf8').trim() === '[';
    }

    const addition = emptyArray ? `\n${indented}\n]` : `,\n${indented}\n]`;
    const additionBuffer = Buffer.from(addition, 'utf8');
    fs.ftruncateSync(fd, closeOffset);
    fs.writeSync(fd, additionBuffer, 0, additionBuffer.length, closeOffset);
  } finally {
    try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}

function backupCorrupt(filePath: string): void {
  try {
    fs.renameSync(filePath, `${filePath}.corrupt-${Date.now()}`);
    console.warn(`[llm-log] preserved malformed log as ${path.basename(filePath)}.corrupt-*`);
  } catch {
    /* best effort */
  }
}
