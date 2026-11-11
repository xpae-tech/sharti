import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { z } from 'zod';
import { DEFAULT_BACKEND_PORT, DEFAULT_FRONTEND_PORT } from '../../../shared/app-defaults.js';

// ─── Shared env value rules ─────────────────────────────────────────────────

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional(),
);

const optionalPort = z.preprocess(
  (value) => (value == null || value === '' ? undefined : value),
  z.coerce.number().int().min(1).max(65_535).optional(),
);

// ─── CLI schema ─────────────────────────────────────────────────────────────

const CliArgsSchema = z.object({
  port: optionalPort,
  runtime: z.string().optional(),
}).passthrough();

// ─── Environment schema ─────────────────────────────────────────────────────

const EnvSchema = z.object({
  SHARTI_BACKEND_PORT: optionalPort,
  SHARTI_FRONTEND_PORT: optionalPort,
  SHARTI_SPLASH_RUNTIME: optionalString,
  SHARTI_FRONTEND_DIR: optionalString,
  SHARTI_DATA_DIR: optionalString,
  SHARTI_ALLOWED_ORIGINS: optionalString,
  SPLASH_API_KEY: optionalString,
});

type Env = z.infer<typeof EnvSchema>;

export interface AppConfig {
  /** Port for the HTTP server */
  readonly port: number;
  /** Port of the Vite dev server (used by the origin allowlist) */
  readonly frontendPort: number;
  /** Absolute path to the project root */
  readonly projectRoot: string;
  /** Resolved Splash runtime root (null if not found) */
  readonly splashRoot: string | null;
  /** Python interpreter for the Splash runtime */
  readonly pythonBin: string;
  /** Path to the compiled Splash engine binary */
  readonly enginePath: string | null;
  /** Root directory where models are stored */
  readonly modelsRoot: string;
  /** Root for lock files */
  readonly locksRoot: string;
  /** Whether the runtime is a packaged release */
  readonly isPackaged: boolean;
  /** Total system RAM in GB */
  readonly ramGb: number;
  /** Data directory (chats, prefs, MCP config) */
  readonly dataDir: string;
  /** Chats sub-directory */
  readonly chatsDir: string;
  /** Folders sub-directory */
  readonly foldersDir: string;
  /** Prefs file path */
  readonly prefsFile: string;
  /** Frontend static directory */
  readonly frontendDir: string;
  /** MCP configuration directory */
  readonly mcpDir: string;
  /** Path to mcp.json */
  readonly mcpJsonPath: string;
  /** Extra browser origins allowed to call the local API */
  readonly allowedOrigins: readonly string[];
  /** Optional Splash engine key supplied via the environment */
  readonly splashApiKey: string | null;
}

// ─── Environment loading ────────────────────────────────────────────────────

/**
 * Loads `.env` from the project root (when present) and validates every
 * supported variable. Invalid values fail fast with a readable message instead
 * of silently falling back to a default.
 */
function loadEnv(projectRoot: string): Env {
  const envFile = path.join(projectRoot, '.env');
  if (fs.existsSync(envFile) && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(envFile);
    } catch {
      // A malformed .env should surface through the schema below, not here.
    }
  }

  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  return result.data;
}

// ─── Resolution Logic ───────────────────────────────────────────────────────

function resolveProjectRoot(): string {
  // Walk up from cwd to find package.json with "sharti" name
  let dir = process.cwd();
  while (dir !== '/') {
    const pkg = path.join(dir, 'package.json');
    if (fs.existsSync(pkg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8'));
        if (parsed.name === 'sharti') return dir;
      } catch { /* ignore */ }
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

function resolveSplashRoot(explicit: string | undefined, envRuntime: string | undefined): string | null {
  const candidates: string[] = [];

  if (explicit) candidates.push(explicit);
  if (envRuntime) candidates.push(envRuntime);
  candidates.push('/Applications/Splash.app/Contents/Resources/splash');

  const home = os.homedir();
  candidates.push(
    path.join(home, 'Projects/splash'),
    path.join(home, 'code/splash'),
    path.join(home, 'Downloads/splash-main'),
  );

  for (const root of candidates) {
    if (!root) continue;
    try {
      if (fs.existsSync(path.join(root, 'install', 'launcher.py'))) {
        return path.resolve(root);
      }
    } catch { /* skip */ }
  }
  return null;
}

function pythonBinFor(root: string): string {
  const candidates = [
    path.join(root, '.venv', 'bin', 'python'),
    path.join(root, 'python', 'bin', 'python3'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'python3';
}

function engineBinaryPath(root: string): string | null {
  const packaged = fs.existsSync(path.join(root, 'release.json'));
  const p = path.join(root, packaged ? 'engine' : 'build', 'splash');
  return fs.existsSync(p) ? p : null;
}

function modelsRootFor(root: string, packaged: boolean): string {
  if (packaged) {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Splash', 'models');
  }
  return path.join(root, 'install', 'models');
}

function locksRootFor(root: string, packaged: boolean): string {
  if (packaged) {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Splash', 'runtime');
  }
  return path.join(root, 'build', 'runtime');
}

/**
 * Runtime data lives at `<projectRoot>/data` (source and mutable state stay
 * separate). `SHARTI_DATA_DIR` overrides the location for deployments. The
 * legacy `<projectRoot>/backend/data` path is still honoured until it has been
 * migrated, so existing installations keep their chats on first upgrade.
 */
function resolveDataDir(projectRoot: string, configured: string | undefined): string {
  if (configured) return path.resolve(projectRoot, configured);
  const rootData = path.join(projectRoot, 'data');
  const legacyData = path.join(projectRoot, 'backend', 'data');
  if (!fs.existsSync(rootData) && fs.existsSync(legacyData)) return legacyData;
  return rootData;
}

// ─── CLI parsing ─────────────────────────────────────────────────────────────

export interface CliArgs {
  port?: number;
  runtime?: string;
}

/**
 * Parses `--key value` and `--key=value` into a plain object before Zod
 * coercion. Exported for tests and reused by loadConfig.
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      raw[body.slice(0, eq)] = body.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        raw[body] = next;
        i++;
      } else {
        raw[body] = '';
      }
    }
  }
  return CliArgsSchema.parse(raw);
}

/** Production build output takes precedence; source tree is the dev fallback. */
function resolveFrontendDir(projectRoot: string, explicit: string | undefined): string {
  if (explicit) return path.resolve(explicit);
  const built = path.join(projectRoot, 'dist', 'frontend');
  if (fs.existsSync(path.join(built, 'index.html'))) return built;
  return path.join(projectRoot, 'frontend');
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function loadConfig(argv: string[]): AppConfig {
  const projectRoot = resolveProjectRoot();
  const env = loadEnv(projectRoot);
  const cli = parseCliArgs(argv);

  const splashRoot = resolveSplashRoot(
    cli.runtime || undefined,
    env.SHARTI_SPLASH_RUNTIME,
  );
  const isPackaged = splashRoot ? fs.existsSync(path.join(splashRoot, 'release.json')) : false;

  const dataDir = resolveDataDir(projectRoot, env.SHARTI_DATA_DIR);
  const frontendDir = resolveFrontendDir(projectRoot, env.SHARTI_FRONTEND_DIR);
  const mcpDir = path.join(dataDir, 'mcp');

  return {
    port: cli.port ?? env.SHARTI_BACKEND_PORT ?? DEFAULT_BACKEND_PORT,
    frontendPort: env.SHARTI_FRONTEND_PORT ?? DEFAULT_FRONTEND_PORT,
    projectRoot,
    splashRoot,
    pythonBin: splashRoot ? pythonBinFor(splashRoot) : 'python3',
    enginePath: splashRoot ? engineBinaryPath(splashRoot) : null,
    modelsRoot: splashRoot ? modelsRootFor(splashRoot, isPackaged) : '',
    locksRoot: splashRoot ? locksRootFor(splashRoot, isPackaged) : '',
    isPackaged,
    ramGb: Math.round(os.totalmem() / 1e9),
    dataDir,
    chatsDir: path.join(dataDir, 'chats'),
    foldersDir: path.join(dataDir, 'folders'),
    prefsFile: path.join(dataDir, 'prefs.json'),
    frontendDir,
    mcpDir,
    mcpJsonPath: path.join(mcpDir, 'mcp.json'),
    allowedOrigins: (env.SHARTI_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    splashApiKey: env.SPLASH_API_KEY ?? null,
  };
}
