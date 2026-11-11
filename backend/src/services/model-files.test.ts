import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { modelFiles, modelIdParts, removeInstalledModel } from './model-files.js';

let root: string;
let modelsRoot: string;
let homeDir: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sharti-models-'));
  modelsRoot = path.join(root, 'models');
  homeDir = path.join(root, 'home');
  fs.mkdirSync(modelsRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function installModel(owner: string, repo: string, variant?: string, hash = 'hash-a'): string {
  const id = `${owner}/${repo}${variant ? `:${variant}` : ''}`;
  const resolvedDir = path.join(modelsRoot, '.resolved', hash);
  fs.mkdirSync(resolvedDir, { recursive: true });
  fs.writeFileSync(path.join(resolvedDir, 'model.json'), JSON.stringify({
    model: id,
    sources: { target: { repo: `${owner}/${repo}` } },
  }));

  const ownerDir = path.join(modelsRoot, owner);
  fs.mkdirSync(ownerDir, { recursive: true });
  fs.symlinkSync(resolvedDir, path.join(ownerDir, `${repo}${variant ? `:${variant}` : ''}`));

  const hubDir = path.join(homeDir, '.cache', 'huggingface', 'hub', `models--${owner}--${repo}`);
  fs.mkdirSync(hubDir, { recursive: true });
  fs.writeFileSync(path.join(hubDir, 'weights.bin'), 'weights');
  return id;
}

describe('modelIdParts', () => {
  it('splits an owner, repository and variant without hardcoding an owner', () => {
    expect(modelIdParts('acme/Model-GGUF:Q4')).toEqual({
      owner: 'acme',
      repo: 'Model-GGUF',
      link: 'Model-GGUF:Q4',
      repoId: 'acme/Model-GGUF',
    });
  });

  it('rejects local paths and unsafe segments', () => {
    expect(modelIdParts('/models/file.gguf')).toBeNull();
    expect(modelIdParts('../escape/model')).toBeNull();
    expect(modelIdParts('owner/../model')).toBeNull();
    expect(modelIdParts('missing-slash')).toBeNull();
    expect(modelIdParts('.resolved/hash')).toBeNull();
  });
});

describe('modelFiles', () => {
  it('derives the owner folder and the matching Hugging Face cache directory', () => {
    const files = modelFiles(modelsRoot, 'someone/Repo:V2', homeDir)!;
    expect(files.ownerDir).toBe(path.join(modelsRoot, 'someone'));
    expect(files.linkPath).toBe(path.join(modelsRoot, 'someone', 'Repo:V2'));
    expect(files.hubDir).toBe(path.join(homeDir, '.cache', 'huggingface', 'hub', 'models--someone--Repo'));
  });
});

describe('removeInstalledModel', () => {
  it('removes the link, resolved copy, Hugging Face cache and empty owner folder', () => {
    const id = installModel('acme', 'Model-GGUF', 'Q4');
    const files = modelFiles(modelsRoot, id, homeDir)!;

    expect(removeInstalledModel({ modelsRoot }, id, homeDir).ok).toBe(true);
    expect(fs.existsSync(files.linkPath)).toBe(false);
    expect(fs.existsSync(path.join(modelsRoot, '.resolved', 'hash-a'))).toBe(false);
    expect(fs.existsSync(files.hubDir)).toBe(false);
    expect(fs.existsSync(files.ownerDir)).toBe(false);
  });

  it('keeps a shared Hugging Face cache while another variant is installed', () => {
    const first = installModel('acme', 'Model-GGUF', 'Q4', 'hash-a');
    installModel('acme', 'Model-GGUF', 'Q5', 'hash-b');
    const files = modelFiles(modelsRoot, first, homeDir)!;

    const result = removeInstalledModel({ modelsRoot }, first, homeDir);
    expect(result.ok).toBe(true);
    expect(result.shared).toContain(files.hubDir);
    expect(fs.existsSync(files.hubDir)).toBe(true);
    expect(fs.existsSync(path.join(modelsRoot, '.resolved', 'hash-a'))).toBe(false);
    expect(fs.existsSync(files.linkPath)).toBe(false);
    expect(fs.existsSync(files.ownerDir)).toBe(true);
  });

  it('keeps shared caches used by a .selections variant', () => {
    const id = installModel('acme', 'Model-GGUF', 'Q4', 'hash-a');
    const files = modelFiles(modelsRoot, id, homeDir)!;
    const selections = path.join(modelsRoot, '.selections');
    fs.mkdirSync(selections, { recursive: true });
    fs.symlinkSync(path.join(modelsRoot, '.resolved', 'hash-a'), path.join(selections, 'language-only'));

    const result = removeInstalledModel({ modelsRoot }, id, homeDir);
    expect(result.ok).toBe(true);
    expect(result.shared).toContain(files.hubDir);
    expect(fs.existsSync(files.hubDir)).toBe(true);
    expect(fs.existsSync(path.join(modelsRoot, '.resolved', 'hash-a'))).toBe(true);
  });

  it('rejects missing and unsupported ids without touching the filesystem', () => {
    const missing = removeInstalledModel({ modelsRoot }, 'acme/Missing', homeDir);
    expect(missing.ok).toBe(false);
    expect(missing.notFound).toBe(true);
    expect(removeInstalledModel({ modelsRoot }, '/local/file.gguf', homeDir).ok).toBe(false);
  });
});
