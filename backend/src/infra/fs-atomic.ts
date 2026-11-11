import fs from 'node:fs';
import path from 'node:path';

/**
 * Writes JSON atomically: serialize to a sibling temp file, then rename.
 * Prevents a crash mid-write from leaving a truncated document behind.
 */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  writeTextAtomic(filePath, JSON.stringify(value, null, 2));
}

/** Writes arbitrary text atomically using the same temp-file strategy. */
export function writeTextAtomic(filePath: string, text: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, filePath);
}
