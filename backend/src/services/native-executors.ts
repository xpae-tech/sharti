// Native Executors: pure execution primitives for the sharti-agent tool suite.
// All functions are synchronous except execCommand (which wraps a child process).
// Designed to be called exclusively by NativeToolsManager.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { TOOLS } from '../config/index.js';

// ─── Shared Types ───────────────────────────────────────────────────────────

export type DirEntry = {
  name: string;
  relativePath: string;
  type: 'file' | 'directory';
  sizeBytes?: number;
};

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
  shell: string;
  platform: string;
};

export type FsOpResult<T = Record<string, unknown>> =
  | { success: true; data: T }
  | { success: false; error: string };

// ─── Path Utilities ─────────────────────────────────────────────────────────

/** Expand leading ~/ to homedir. Does NOT resolve .. or symlinks. */
export function expandHome(p: string): string {
  if (p.startsWith('~') && (p.length === 1 || p[1] === '/' || p[1] === '\\')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

/** Resolve a path safely: expand ~, resolve to absolute, normalize. */
export function safeResolve(input: string): string {
  return path.resolve(expandHome(input));
}

// ─── File Operations ────────────────────────────────────────────────────────

export function opReadFile(filePath: string): FsOpResult<{ filePath: string; content: string; sizeBytes: number }> {
  try {
    const resolved = safeResolve(filePath);
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return { success: false, error: `Path is a directory, not a file: ${resolved}` };

    const size = stat.size;
    if (size > TOOLS.readFileMaxBytes) {
      return { success: false, error: `File exceeds read limit (${TOOLS.readFileMaxBytes} bytes). Size: ${size} bytes.` };
    }

    const content = fs.readFileSync(resolved, 'utf-8');
    return { success: true, data: { filePath: resolved, content, sizeBytes: size } };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export function opWriteFile(filePath: string, content: string): FsOpResult<{ filePath: string; bytesWritten: number }> {
  try {
    const resolved = safeResolve(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, content, 'utf-8');
    return { success: true, data: { filePath: resolved, bytesWritten: Buffer.byteLength(content, 'utf-8') } };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export function opPatchFile(
  filePath: string,
  searchString: string,
  replaceString: string,
): FsOpResult<{ filePath: string; occurrences: number }> {
  try {
    const resolved = safeResolve(filePath);
    if (!fs.existsSync(resolved)) return { success: false, error: `File not found: ${resolved}` };

    const content = fs.readFileSync(resolved, 'utf-8');
    if (!content.includes(searchString)) {
      return { success: false, error: 'Search string not found in file. Ensure exact whitespace/indentation.' };
    }

    // Count occurrences for reporting
    let count = 0;
    let idx = 0;
    while ((idx = content.indexOf(searchString, idx)) !== -1) {
      count++;
      idx += searchString.length;
    }

    // Function replacer: prevents `$&`, `$1`, `$'` etc. in user content from
    // being interpreted as replacement patterns.
    const patched = content.replace(searchString, () => replaceString);
    fs.writeFileSync(resolved, patched, 'utf-8');
    return { success: true, data: { filePath: resolved, occurrences: count } };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export function opAppendToFile(filePath: string, content: string): FsOpResult<{ filePath: string; bytesAppended: number }> {
  try {
    const resolved = safeResolve(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.appendFileSync(resolved, content, 'utf-8');
    return { success: true, data: { filePath: resolved, bytesAppended: Buffer.byteLength(content, 'utf-8') } };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

// ─── Directory Operations ───────────────────────────────────────────────────

export function opListDirectory(dirPath: string, recursive = false): FsOpResult<{ dirPath: string; entryCount: number; tree: string; entries: DirEntry[] }> {
  try {
    const resolved = safeResolve(dirPath);
    if (!fs.existsSync(resolved)) return { success: false, error: `Directory not found: ${resolved}` };

    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) return { success: false, error: `Path is not a directory: ${resolved}` };

    const MAX_DEPTH = recursive ? TOOLS.maxListDepth : 1;
    const entries: DirEntry[] = [];

    function walk(dir: string, relBase: string, depth: number): void {
      if (depth > MAX_DEPTH) return;
      const children = fs.readdirSync(dir, { withFileTypes: true });
      for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = relBase ? `${relBase}/${child.name}` : child.name;
        const abs = path.join(dir, child.name);
        if (child.isDirectory()) {
          entries.push({ name: child.name, relativePath: rel, type: 'directory' });
          walk(abs, rel, depth + 1);
        } else {
          let size: number | undefined;
          try { size = fs.statSync(abs).size; } catch { /* broken symlink etc. */ }
          entries.push({ name: child.name, relativePath: rel, type: 'file', sizeBytes: size });
        }
      }
    }

    walk(resolved, '', 0);
    const tree = formatTree(entries, path.basename(resolved));
    return { success: true, data: { dirPath: resolved, entryCount: entries.length, tree, entries } };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export function opCreateDirectory(dirPath: string): FsOpResult<{ dirPath: string; created: boolean }> {
  try {
    const resolved = safeResolve(dirPath);
    const existed = fs.existsSync(resolved);
    fs.mkdirSync(resolved, { recursive: true });
    return { success: true, data: { dirPath: resolved, created: !existed } };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export function opDeleteFile(filePath: string, recursive = false): FsOpResult<{ deletedPath: string }> {
  try {
    const resolved = safeResolve(filePath);
    if (!fs.existsSync(resolved)) return { success: false, error: `Path not found: ${resolved}` };

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      fs.rmSync(resolved, { recursive, force: false });
    } else {
      fs.unlinkSync(resolved);
    }
    return { success: true, data: { deletedPath: resolved } };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export function opMoveFile(sourcePath: string, destPath: string): FsOpResult<{ sourcePath: string; destinationPath: string }> {
  try {
    const src = safeResolve(sourcePath);
    let dst = safeResolve(destPath);

    if (!fs.existsSync(src)) return { success: false, error: `Source not found: ${src}` };

    // If destination is an existing directory, move INTO it
    if (fs.existsSync(dst) && fs.statSync(dst).isDirectory()) {
      dst = path.join(dst, path.basename(src));
    }

    if (fs.existsSync(dst)) {
      return { success: false, error: `Destination already exists: ${dst}. Remove or rename it first.` };
    }

    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    return { success: true, data: { sourcePath: src, destinationPath: dst } };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

export function opRenameFile(filePath: string, newName: string): FsOpResult<{ oldPath: string; newPath: string }> {
  try {
    const resolved = safeResolve(filePath);
    if (!fs.existsSync(resolved)) return { success: false, error: `Path not found: ${resolved}` };

    if (path.basename(newName) !== newName) {
      return { success: false, error: 'new_name must be a plain name without directory separators. Use move_file to change location.' };
    }

    const destination = path.join(path.dirname(resolved), newName);
    if (fs.existsSync(destination)) {
      return { success: false, error: `A file named "${newName}" already exists in that directory.` };
    }

    fs.renameSync(resolved, destination);
    return { success: true, data: { oldPath: resolved, newPath: destination } };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}

// ─── Environment Info ───────────────────────────────────────────────────────

export function opGetEnvironment(): FsOpResult<{ homeDir: string; cwd: string; platform: string; arch: string; nodeVersion: string; pathSeparator: string }> {
  return {
    success: true,
    data: {
      homeDir: os.homedir(),
      cwd: process.cwd(),
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      pathSeparator: path.sep,
    },
  };
}

// ─── Command Execution ──────────────────────────────────────────────────────

interface ShellInfo {
  bin: string;
  args: string[];
}

function resolveShell(): ShellInfo {
  const plat = process.platform;

  if (plat === 'win32') {
    // Prefer PowerShell 7+, fall back to powershell.exe, then cmd
    const psCandidates = [
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ];
    for (const p of psCandidates) {
      if (fs.existsSync(p)) return { bin: p, args: ['-NoProfile', '-NonInteractive', '-Command'] };
    }
    return { bin: 'cmd.exe', args: ['/c'] };
  }

  // Unix: respect $SHELL if valid
  if (process.env.SHELL) {
    try {
      if (fs.existsSync(process.env.SHELL)) {
        return { bin: process.env.SHELL, args: ['-c'] };
      }
    } catch { /* ignore */ }
  }

  for (const sh of ['/bin/bash', '/usr/bin/bash', '/bin/zsh', '/usr/local/bin/zsh', '/bin/sh']) {
    try {
      if (fs.existsSync(sh)) return { bin: sh, args: ['-c'] };
    } catch { /* ignore */ }
  }

  return { bin: '/bin/sh', args: ['-c'] };
}

function truncateOutput(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf-8');
  if (buf.length <= maxBytes) return text;
  return buf.subarray(0, maxBytes).toString('utf-8') + `\n[output truncated at ${maxBytes} bytes]`;
}

function normalizeEOL(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
}

export function execCommand(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const shell = resolveShell();
    const cwd = opts.cwd ? safeResolve(opts.cwd) : os.homedir();
    const timeoutMs = Math.min(opts.timeoutMs ?? TOOLS.defaultTimeoutMs, TOOLS.maxTimeoutMs);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      ...(opts.env ?? {}),
    };

    // Validate cwd
    let effectiveCwd = cwd;
    try {
      if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        effectiveCwd = os.homedir();
      }
    } catch {
      effectiveCwd = os.homedir();
    }

    let proc: ChildProcess;
    try {
      proc = spawn(shell.bin, [...shell.args, command], {
        cwd: effectiveCwd,
        env,
        windowsHide: true,
      });
    } catch (err) {
      resolve({
        stdout: '',
        stderr: err instanceof Error ? err.message : String(err),
        exitCode: 1,
        timedOut: false,
        shell: shell.bin,
        platform: process.platform,
      });
      return;
    }

    let stdout = '';
    let stderr = '';
    let killed = false;

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf-8'); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf-8'); });

    const timer = setTimeout(() => {
      killed = true;
      try { proc.kill('SIGKILL'); } catch { /* already dead */ }
    }, timeoutMs);

    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout: truncateOutput(normalizeEOL(stdout), TOOLS.maxOutputBytes),
        stderr: truncateOutput(normalizeEOL(stderr), TOOLS.maxOutputBytes),
        exitCode: code ?? 1,
        timedOut: killed,
        shell: shell.bin,
        platform: process.platform,
      });
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout: '',
        stderr: err.message,
        exitCode: 1,
        timedOut: false,
        shell: shell.bin,
        platform: process.platform,
      });
    });
  });
}

// ─── Formatting Helpers ─────────────────────────────────────────────────────

function formatTree(entries: DirEntry[], rootName: string): string {
  if (entries.length === 0) return `${rootName}/ (empty)`;

  const lines: string[] = [`${rootName}/`];
  for (const entry of entries) {
    const depth = entry.relativePath.split(/[/\\]/).length - 1;
    const indent = '  '.repeat(depth);
    if (entry.type === 'directory') {
      lines.push(`${indent}${entry.name}/`);
    } else {
      const sizeStr = entry.sizeBytes != null
        ? entry.sizeBytes >= 1024
          ? `(${formatSize(entry.sizeBytes)})`
          : `(${entry.sizeBytes}B)`
        : '';
      lines.push(`${indent}${entry.name} ${sizeStr}`.trimEnd());
    }
  }
  return lines.join('\n');
}

function formatSize(bytes: number): string {
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${bytes}B`;
}
