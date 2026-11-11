import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  execCommand,
  expandHome,
  opAppendToFile,
  opCreateDirectory,
  opDeleteFile,
  opListDirectory,
  opMoveFile,
  opPatchFile,
  opReadFile,
  opRenameFile,
  opWriteFile,
} from './native-executors.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sharti-exec-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('native executors', () => {
  it('writes, reads and appends files', () => {
    const file = path.join(dir, 'nested', 'a.txt');
    expect(opWriteFile(file, 'hello').success).toBe(true);
    expect(opAppendToFile(file, ' world').success).toBe(true);
    const read = opReadFile(file);
    expect(read.success).toBe(true);
    if (read.success) expect(read.data.content).toBe('hello world');
  });

  it('patches literal replacement strings without regex patterns', () => {
    const file = path.join(dir, 'patch.txt');
    opWriteFile(file, 'x = x');
    const result = opPatchFile(file, 'x', '$& and $1');
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.occurrences).toBe(2);
    if (opReadFile(file).success) {
      expect((opReadFile(file) as { data: { content: string } }).data.content).toBe('$& and $1 = x');
    }
  });

  it('creates, lists, moves and renames directories', () => {
    expect(opCreateDirectory(path.join(dir, 'a', 'b')).success).toBe(true);
    opWriteFile(path.join(dir, 'a', 'f.txt'), 'x');
    const listing = opListDirectory(dir, true);
    expect(listing.success).toBe(true);
    if (listing.success) expect(listing.data.entryCount).toBe(3);

    expect(opRenameFile(path.join(dir, 'a', 'f.txt'), 'g.txt').success).toBe(true);
    expect(opMoveFile(path.join(dir, 'a'), path.join(dir, 'moved')).success).toBe(true);
    expect(fs.existsSync(path.join(dir, 'moved', 'g.txt'))).toBe(true);
  });

  it('deletes files and non-empty directories', () => {
    opWriteFile(path.join(dir, 'a', 'f.txt'), 'x');
    expect(opDeleteFile(path.join(dir, 'a'), true).success).toBe(true);
    expect(fs.existsSync(path.join(dir, 'a'))).toBe(false);
  });

  it('expands a leading home marker', () => {
    expect(expandHome('~/x')).toBe(path.join(os.homedir(), 'x'));
    expect(expandHome('~user/x')).toBe('~user/x');
  });

  it('executes shell commands and reports output', async () => {
    const result = await execCommand('printf hello');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello');
  });

  it('kills commands that exceed the timeout', async () => {
    const result = await execCommand('sleep 5', { timeoutMs: 50 });
    expect(result.timedOut).toBe(true);
  });
});
