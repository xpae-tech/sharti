import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AppConfig } from '../config/index.js';
import { resolveWithin } from '../infra/paths.js';
import { discoverInstalledModels } from './model-discovery.js';

/** Filesystem locations belonging to one Hugging Face model id. */
export interface ModelFiles {
  /** `models/<owner>` */
  readonly ownerDir: string;
  /** `models/<owner>/<repo>[:variant]` */
  readonly linkPath: string;
  /** `~/.cache/huggingface/hub` */
  readonly hubRoot: string;
  /** `~/.cache/huggingface/hub/models--<owner>--<repo>` */
  readonly hubDir: string;
  /** Repository id without the variant, e.g. `owner/repo`. */
  readonly repoId: string;
}

interface ModelIdParts {
  owner: string;
  repo: string;
  /** The directory name in `models/<owner>`: `<repo>[:variant]`. */
  link: string;
  repoId: string;
}

function safeSegment(value: string): boolean {
  return Boolean(value)
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\')
    && !value.includes('\0');
}

/** Splits `owner/repo[:variant]` into safe path components. */
export function modelIdParts(modelId: string): ModelIdParts | null {
  if (!modelId || modelId.startsWith('/')) return null;
  const base = modelId.split(':')[0];
  const slash = base.indexOf('/');
  if (slash <= 0) return null;
  const owner = base.slice(0, slash);
  const repo = base.slice(slash + 1);
  const link = modelId.slice(owner.length + 1);
  if (!safeSegment(owner) || owner.startsWith('.') || !safeSegment(repo) || !safeSegment(link)) return null;
  return { owner, repo, link, repoId: `${owner}/${repo}` };
}

/** Resolves every directory a model id can live in, without touching disk. */
export function modelFiles(
  modelsRoot: string,
  modelId: string,
  homeDir = os.homedir(),
): ModelFiles | null {
  if (!modelsRoot) return null;
  const parts = modelIdParts(modelId);
  if (!parts) return null;
  const hubRoot = path.join(homeDir, '.cache', 'huggingface', 'hub');
  return {
    ownerDir: path.join(modelsRoot, parts.owner),
    linkPath: path.join(modelsRoot, parts.owner, parts.link),
    hubRoot,
    hubDir: path.join(hubRoot, `models--${parts.owner}--${parts.repo}`),
    repoId: parts.repoId,
  };
}

function realpathOrNull(target: string): string | null {
  try { return fs.realpathSync(target); } catch { return null; }
}

/** True when `link` is a symlink resolving to `target`. */
function isLinkTo(link: string, target: string): boolean {
  try {
    return fs.lstatSync(link).isSymbolicLink() && fs.realpathSync(link) === target;
  } catch {
    return false;
  }
}

/**
 * True when another selection link anywhere under modelsRoot points at
 * `target`. Dot-prefixed directories are included because Splash keeps
 * language-only, revision and draft variants in `.selections`.
 */
function hasOtherLinkTo(modelsRoot: string, target: string, exclude: string): boolean {
  let dirs: fs.Dirent[] = [];
  try { dirs = fs.readdirSync(modelsRoot, { withFileTypes: true }); } catch { return false; }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const dirPath = path.join(modelsRoot, dir.name);
    let entries: string[] = [];
    try { entries = fs.readdirSync(dirPath); } catch { continue; }
    for (const entry of entries) {
      const link = path.join(dirPath, entry);
      if (link === exclude) continue;
      if (isLinkTo(link, target)) return true;
    }
  }
  return false;
}

/** True when a `.selections` variant still uses this Hub repository. */
function selectionUsesRepo(modelsRoot: string, repoId: string): boolean {
  const dir = path.join(modelsRoot, '.selections');
  let entries: string[] = [];
  try { entries = fs.readdirSync(dir); } catch { return false; }
  for (const entry of entries) {
    const manifest = path.join(dir, entry, 'model.json');
    try {
      const rec = JSON.parse(fs.readFileSync(manifest, 'utf8')) as {
        sources?: Record<string, unknown>;
      };
      for (const source of Object.values(rec.sources ?? {})) {
        if (source && typeof source === 'object' && (source as { repo?: unknown }).repo === repoId) {
          return true;
        }
      }
    } catch { /* missing or non-assembly selection */ }
  }
  return false;
}

export interface ModelRemovalResult {
  readonly ok: boolean;
  /** Paths actually removed. */
  readonly removed: string[];
  /** Model-specific paths kept because another installed variant uses them. */
  readonly shared: string[];
  readonly error?: string;
  /** True when the id is not one of the installed models. */
  readonly notFound?: boolean;
}

/**
 * Removes one installed model from every location it may occupy. Paths that
 * do not exist are skipped; other filesystem errors are reported while the
 * remaining locations are still cleaned up.
 *
 * Only the selected model is removed. A shared `.resolved/<hash>` directory or
 * Hugging Face repository cache stays when another installed or selected
 * variant points at it, and an owner directory is removed only once it is
 * empty.
 */
export function removeInstalledModel(
  cfg: Pick<AppConfig, 'modelsRoot'>,
  modelId: string,
  homeDir = os.homedir(),
): ModelRemovalResult {
  const files = modelFiles(cfg.modelsRoot, modelId, homeDir);
  if (!files) return { ok: false, removed: [], shared: [], error: 'Unsupported model id' };

  const installed = discoverInstalledModels(cfg.modelsRoot);
  const target = installed.find((m) => m.id === modelId);
  if (!target) {
    return { ok: false, removed: [], shared: [], error: 'Model is not installed', notFound: true };
  }

  const linkPath = target.path;
  const ownerDir = path.dirname(linkPath);
  const others = installed.filter((m) => m.id !== modelId);
  const resolved = realpathOrNull(linkPath);
  const resolvedRoot = path.join(cfg.modelsRoot, '.resolved');
  const resolvedTarget = resolved ? resolveWithin(resolvedRoot, resolved) : null;
  const sharedResolved = resolved !== null
    && hasOtherLinkTo(cfg.modelsRoot, resolved, linkPath);
  const sharedHub = others.some((m) => modelIdParts(m.id)?.repoId === files.repoId)
    || selectionUsesRepo(cfg.modelsRoot, files.repoId);

  const removed: string[] = [];
  const shared: string[] = [];
  const errors: string[] = [];

  const removePath = (target: string): void => {
    try {
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(target);
    } catch (e) {
      errors.push(`${path.basename(target)}: ${(e as Error).message}`);
    }
  };

  // Remove the discovered model link itself, never an internally derived path:
  // a malformed id must not turn `.resolved` or `.metadata` into a target.
  removePath(linkPath);

  if (resolvedTarget) {
    if (sharedResolved) shared.push(resolvedTarget);
    else removePath(resolvedTarget);
  }

  if (sharedHub) shared.push(files.hubDir);
  else removePath(files.hubDir);

  // Drop the owner directory once its last model is gone.
  try {
    const remaining = fs.readdirSync(ownerDir).filter((name) => name !== '.DS_Store');
    if (remaining.length === 0) {
      fs.rmSync(path.join(ownerDir, '.DS_Store'), { force: true });
      fs.rmdirSync(ownerDir);
    }
  } catch { /* missing or non-empty owner directory */ }

  return errors.length
    ? { ok: false, removed, shared, error: errors.join('; ') }
    : { ok: true, removed, shared };
}
