// NativeToolsManager: in-process tool suite providing filesystem and CLI access.
// Mirrors the tool surface of the LM Studio agent plugin but executes directly
// in the backend process (no subprocess IPC for FS operations).
//
// Integration notes:
//   • Tool defs conform to McpToolDef so the frontend renders them uniformly.
//   • Invocations produce the same McpToolCallResult shape as MCP calls.
//   • The caller (client-side agent loop) records calls via the existing
//     ThreadSegment / McpToolInvocation pipeline using serverId = NATIVE_SERVER_ID.

import type {
  McpToolDef,
  McpToolCallResult,
  NativeToolsState,
} from '../domain/types.js';
import { NATIVE_SERVER_ID } from '../domain/types.js';
import type { Prefs } from '../domain/types.js';
import { TOOLS } from '../config/index.js';
import {
  opReadFile,
  opWriteFile,
  opPatchFile,
  opAppendToFile,
  opListDirectory,
  opCreateDirectory,
  opDeleteFile,
  opMoveFile,
  opRenameFile,
  opGetEnvironment,
  execCommand,
  safeResolve,
} from './native-executors.js';

// ─── Tool Parameter Schemas (JSON Schema subset for LLM consumption) ────────

const schemas = {
  readFile: {
    type: 'object' as const,
    properties: {
      file_path: { type: 'string', minLength: 1, description: "Absolute path to the file to read. Supports ~ for home directory." },
    },
    required: ['file_path'],
  },
  writeFile: {
    type: 'object' as const,
    properties: {
      file_path: { type: 'string', minLength: 1, description: "Absolute path to the file to write/create. Parent dirs auto-created." },
      content: { type: 'string', description: 'Full content to write to the file.' },
    },
    required: ['file_path', 'content'],
  },
  patchFile: {
    type: 'object' as const,
    properties: {
      file_path: { type: 'string', minLength: 1, description: 'Absolute path to the file to modify.' },
      search_string: { type: 'string', minLength: 1, description: 'Exact string to find (including whitespace/indentation).' },
      replace_string: { type: 'string', description: 'Replacement string.' },
    },
    required: ['file_path', 'search_string', 'replace_string'],
  },
  appendToFile: {
    type: 'object' as const,
    properties: {
      file_path: { type: 'string', minLength: 1, description: 'Absolute path to the file to append to. Created if missing.' },
      content: { type: 'string', description: 'Text to append. Include leading \\n for a blank line before.' },
    },
    required: ['file_path', 'content'],
  },
  listDirectory: {
    type: 'object' as const,
    properties: {
      dir_path: { type: 'string', minLength: 1, description: 'Absolute path of the directory to list. Supports ~.' },
      recursive: { type: 'boolean', description: 'Recursively list all files/subdirs. Default false (top-level only).' },
    },
    required: ['dir_path'],
  },
  createDirectory: {
    type: 'object' as const,
    properties: {
      dir_path: { type: 'string', minLength: 1, description: 'Absolute path of the directory to create. Parents auto-created.' },
    },
    required: ['dir_path'],
  },
  deleteFile: {
    type: 'object' as const,
    properties: {
      file_path: { type: 'string', minLength: 1, description: 'Absolute path to the file or directory to delete.' },
      recursive: { type: 'boolean', description: 'Required true to delete a non-empty directory. Default false.' },
    },
    required: ['file_path'],
  },
  moveFile: {
    type: 'object' as const,
    properties: {
      source_path: { type: 'string', minLength: 1, description: 'Absolute path of the file/directory to move.' },
      destination_path: { type: 'string', minLength: 1, description: 'Destination path. If an existing dir, moves INTO it.' },
    },
    required: ['source_path', 'destination_path'],
  },
  renameFile: {
    type: 'object' as const,
    properties: {
      file_path: { type: 'string', minLength: 1, description: 'Absolute path of the file/directory to rename.' },
      new_name: { type: 'string', minLength: 1, description: 'New basename only (no path separators).' },
    },
    required: ['file_path', 'new_name'],
  },
  getEnvironment: {
    type: 'object' as const,
    properties: {},
  },
  runCommand: {
    type: 'object' as const,
    properties: {
      command: { type: 'string', minLength: 1, maxLength: TOOLS.maxCommandLength, description: 'Shell command to execute.' },
      cwd: { type: 'string', description: 'Working directory. Supports ~. Defaults to home.' },
      timeout_ms: { type: 'integer', minimum: 1_000, maximum: TOOLS.maxTimeoutMs, description: `Timeout in ms. Default ${TOOLS.defaultTimeoutMs}. Max ${TOOLS.maxTimeoutMs}.` },
      env: { type: 'object', additionalProperties: { type: 'string' }, description: 'Additional environment variables for the command.' },
    },
    required: ['command'],
  },
} satisfies Record<string, Record<string, unknown>>;

// ─── Tool Descriptions ──────────────────────────────────────────────────────

const DESC = {
  readFile: 'Read the contents of a file from disk. Returns UTF-8 text. Use this to inspect code, configs, data files.',
  writeFile: 'Create or overwrite a file with the given content. Parent directories are created automatically. Prefer this over shell echo/cat for writing files.',
  patchFile: 'Replace the first occurrence of an exact substring in a file. More precise than rewrite-whole-file for small edits. Search string must match byte-for-byte including whitespace.',
  appendToFile: 'Append text to the end of a file. Creates the file if it does not exist. Good for logs, .env additions, incremental writes.',
  listDirectory: 'List files and subdirectories in a directory. Returns a human-readable tree plus structured entries. Use recursive=true for deep listings (limited to depth 10).',
  createDirectory: 'Create a directory and all intermediate parents (equivalent to mkdir -p). Idempotent: no error if it already exists.',
  deleteFile: 'Permanently delete a file or directory. Cannot be undone. Use recursive=true for non-empty directories.',
  moveFile: 'Move or rename a file/directory to a new location. Fails if destination already exists.',
  renameFile: 'Rename a file or directory in place (same parent directory). Destination name must not contain path separators.',
  getEnvironment: 'Return environment metadata: home directory, current working directory, OS platform, CPU arch, Node.js version. Useful at the start of a task involving paths.',
  runCommand: 'Execute a shell command on the host. Runs in the user\'s login shell (bash/zsh on macOS/Linux, PowerShell/cmd on Windows). Returns stdout, stderr, exit code. Do NOT use for writing files — prefer write_file/patch_file.',
};

// ─── Public Class ───────────────────────────────────────────────────────────

// Tools are intentionally NOT sandboxed. File operations and run_command can
// reach any path the backend user can. This protects against accidental
// mistakes only, not against a malicious caller; access control is future work.
export class NativeToolsManager {
  private _initialized = false;
  private prefsGetter: () => Prefs;
  private onChangeCb: (() => void) | null = null;

  constructor(getPrefs: () => Prefs) {
    this.prefsGetter = getPrefs;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  init(): void {
    this._initialized = true;
    this.notifyChange();
  }

  dispose(): void {
    this._initialized = false;
    this.onChangeCb = null;
  }

  onStateChange(cb: () => void): void {
    this.onChangeCb = cb;
  }

  private notifyChange(): void {
    if (this._initialized) this.onChangeCb?.();
  }

  // ── State ─────────────────────────────────────────────────────────────────

  getState(): NativeToolsState {
    const prefs = this.prefsGetter();
    const enabled = prefs.nativeToolsEnabled;
    const disabledNames = prefs.disabledNativeTools;

    const tools = enabled
      ? this.buildAllDefs().filter((t) => !disabledNames.includes(t.name))
      : [];

    return {
      tools,
      initialized: this._initialized,
      enabled,
    };
  }






  // ── Dispatch ──────────────────────────────────────────────────────────────

  /**
   * Execute a native tool by name.
   * Returns McpToolCallResult compatible with the standard tool-call pipeline.
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const prefs = this.prefsGetter();
    if (!prefs.nativeToolsEnabled) {
      return { content: [{ type: 'text', text: 'Native tools are disabled. Enable via Settings → Agent.' }], isError: true };
    }
    if (prefs.disabledNativeTools.includes(toolName)) {
      return { content: [{ type: 'text', text: `Tool "${toolName}" is individually disabled.` }], isError: true };
    }

    try {
      const result = await this.dispatch(toolName, args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: false,
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text', text: msg }], isError: true };
    }
  }

  // ── Internal dispatch table ──────────────────────────────────────────────

  private async dispatch(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (name) {
      case 'read_file':
        return this.executeRead(args);
      case 'write_file':
        return this.executeWrite(args);
      case 'patch_file':
        return this.executePatch(args);
      case 'append_to_file':
        return this.executeAppend(args);
      case 'list_directory':
        return this.executeListDir(args);
      case 'create_directory':
        return this.executeCreateDir(args);
      case 'delete_file':
        return this.executeDelete(args);
      case 'move_file':
        return this.executeMove(args);
      case 'rename_file':
        return this.executeRename(args);
      case 'get_environment':
        return this.executeEnv();
      case 'run_command':
        return this.executeRunCmd(args);
      default:
        throw new Error(`Unknown native tool: ${name}`);
    }
  }

  // ── Executor wrappers (thin adapters: extract typed args → call primitive → normalize) ──

  private executeRead(args: Record<string, unknown>): Record<string, unknown> {
    const filePath = strArg(args, 'file_path');
    const r = opReadFile(filePath);
    return r.success ? { success: true, ...r.data } : { success: false, error: r.error };
  }

  private executeWrite(args: Record<string, unknown>): Record<string, unknown> {
    const filePath = strArg(args, 'file_path');
    const content = strArg(args, 'content');
    const r = opWriteFile(filePath, content);
    return r.success ? { success: true, ...r.data } : { success: false, error: r.error };
  }

  private executePatch(args: Record<string, unknown>): Record<string, unknown> {
    const filePath = strArg(args, 'file_path');
    const search = strArg(args, 'search_string');
    const replace = strArg(args, 'replace_string');
    const r = opPatchFile(filePath, search, replace);
    return r.success ? { success: true, ...r.data } : { success: false, error: r.error };
  }

  private executeAppend(args: Record<string, unknown>): Record<string, unknown> {
    const filePath = strArg(args, 'file_path');
    const content = strArg(args, 'content');
    const r = opAppendToFile(filePath, content);
    return r.success ? { success: true, ...r.data } : { success: false, error: r.error };
  }

  private executeListDir(args: Record<string, unknown>): Record<string, unknown> {
    const dirPath = strArg(args, 'dir_path');
    const recursive = boolArg(args, 'recursive');
    const r = opListDirectory(dirPath, recursive);
    return r.success ? { success: true, ...r.data } : { success: false, error: r.error };
  }

  private executeCreateDir(args: Record<string, unknown>): Record<string, unknown> {
    const dirPath = strArg(args, 'dir_path');
    const r = opCreateDirectory(dirPath);
    return r.success ? { success: true, ...r.data } : { success: false, error: r.error };
  }

  private executeDelete(args: Record<string, unknown>): Record<string, unknown> {
    const filePath = strArg(args, 'file_path');
    const recursive = boolArg(args, 'recursive');
    const r = opDeleteFile(filePath, recursive);
    return r.success ? { success: true, ...r.data } : { success: false, error: r.error };
  }

  private executeMove(args: Record<string, unknown>): Record<string, unknown> {
    const src = strArg(args, 'source_path');
    const dst = strArg(args, 'destination_path');
    const r = opMoveFile(src, dst);
    return r.success ? { success: true, ...r.data } : { success: false, error: r.error };
  }

  private executeRename(args: Record<string, unknown>): Record<string, unknown> {
    const filePath = strArg(args, 'file_path');
    const newName = strArg(args, 'new_name');
    const r = opRenameFile(filePath, newName);
    return r.success ? { success: true, ...r.data } : { success: false, error: r.error };
  }

  private executeEnv(): Record<string, unknown> {
    const r = opGetEnvironment();
    return r.success ? { success: true, ...r.data } : { success: false, error: r.error };
  }

  private async executeRunCmd(args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const command = strArg(args, 'command');
    const requestedCwd = optStrArg(args, 'cwd');
    // Any cwd is allowed; only a default is provided for convenience.
    const cwd = requestedCwd ? safeResolve(requestedCwd) : process.cwd();
    const timeoutMs = intArg(args, 'timeout_ms') ?? TOOLS.defaultTimeoutMs;
    const envRaw = args['env'];
    const env = envRaw && typeof envRaw === 'object'
      ? Object.fromEntries(Object.entries(envRaw as Record<string, unknown>).map(([k, v]) => [k, String(v)]))
      : undefined;

    const result = await execCommand(command, { cwd, timeoutMs, env });

    const hints: string[] = [];
    if (result.timedOut) {
      hints.push(`Command exceeded ${timeoutMs}ms timeout. Consider increasing timeout_ms or breaking into smaller steps.`);
    }
    if (result.exitCode !== 0 && !result.timedOut && result.stderr) {
      hints.push('Command exited with non-zero code. Inspect stderr above.');
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      platform: result.platform,
      shell: result.shell,
      ...(hints.length > 0 ? { hints } : {}),
    };
  }

  // ── Tool definition builder ──────────────────────────────────────────────

  private buildAllDefs(): McpToolDef[] {
    return [
      def('read_file', DESC.readFile, schemas.readFile),
      def('write_file', DESC.writeFile, schemas.writeFile),
      def('patch_file', DESC.patchFile, schemas.patchFile),
      def('append_to_file', DESC.appendToFile, schemas.appendToFile),
      def('list_directory', DESC.listDirectory, schemas.listDirectory),
      def('create_directory', DESC.createDirectory, schemas.createDirectory),
      def('delete_file', DESC.deleteFile, schemas.deleteFile),
      def('move_file', DESC.moveFile, schemas.moveFile),
      def('rename_file', DESC.renameFile, schemas.renameFile),
      def('get_environment', DESC.getEnvironment, schemas.getEnvironment),
      def('run_command', DESC.runCommand, schemas.runCommand),
    ];
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function def(name: string, description: string, inputSchema: Record<string, unknown>): McpToolDef {
  return {
    id: `${NATIVE_SERVER_ID}:${name}`,
    serverId: NATIVE_SERVER_ID,
    name,
    description,
    inputSchema,
  };
}

function strArg(args: Record<string, unknown>, key: string): string {
  const val = args[key];
  if (typeof val !== 'string' || !val.trim()) {
    throw new Error(`Missing required argument: "${key}"`);
  }
  return val;
}

function optStrArg(args: Record<string, unknown>, key: string): string | undefined {
  const val = args[key];
  return typeof val === 'string' && val.trim() ? val : undefined;
}

function boolArg(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}

function intArg(args: Record<string, unknown>, key: string): number | undefined {
  const val = args[key];
  return typeof val === 'number' && Number.isFinite(val) ? val : undefined;
}
