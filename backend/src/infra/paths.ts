import fs from 'node:fs';
import path from 'node:path';

/**
 * Resolves `candidate` and guarantees it stays inside `root`.
 * Returns the resolved absolute path or null when the candidate escapes root.
 * Symlinks are resolved when the target already exists.
 */
export function resolveWithin(root: string, candidate: string): string | null {
  if (!root) return null;
  try {
    const realRoot = fs.realpathSync(root);
    const absolute = path.resolve(realRoot, candidate);
    const realTarget = fs.existsSync(absolute) ? fs.realpathSync(absolute) : absolute;
    const rel = path.relative(realRoot, realTarget);
    if (rel === '') return realTarget;
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    return realTarget;
  } catch {
    return null;
  }
}

export function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
