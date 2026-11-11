// MCP Manager: manages MCP server lifecycles, tool discovery, and tool execution.
// Communicates with MCP servers via stdio (NDJSON JSON-RPC 2.0).

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import { writeTextAtomic } from '../infra/fs-atomic.js';
import { MCP } from '../config/index.js';
import type {
  McpServerConfig,
  McpServerLifecycle,
  McpToolDef,
  McpState,
  McpToolCallParams,
  McpToolCallResult,
} from '../domain/types.js';

// ─── Internal types ─────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface PendingRequest {
  resolve: (msg: JsonRpcResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface McpServerRuntime {
  id: string;
  label: string;
  config: McpServerConfig;
  proc: ChildProcessWithoutNullStreams | null;
  status: McpServerLifecycle;
  error: string | null;
  nextRequestId: number;
  pending: Map<number, PendingRequest>;
  stdoutBuf: string;
  stderrLines: string[];
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PROTOCOL_VERSION = MCP.protocolVersion;
const CLIENT_NAME = MCP.clientName;
const CLIENT_VERSION = MCP.clientVersion;
const INIT_TIMEOUT_MS = MCP.initTimeoutMs;
const CALL_TIMEOUT_MS = MCP.callTimeoutMs;
const CONFIG_POLL_INTERVAL_MS = MCP.configPollIntervalMs;

// ─── Public Class ───────────────────────────────────────────────────────────

export class McpManager {
  private runtimes: Map<string, McpServerRuntime> = new Map();
  private tools: McpToolDef[] = [];
  private lastLoaded: number | null = null;
  private lastConfigHash: string = '';
  /** Server IDs in the order they appear in mcp.json. */
  private configOrder: string[] = [];
  private jsonPath: string;
  private onChangeCb: (() => void) | null = null;
  private disposed = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(jsonPath: string) {
    this.jsonPath = jsonPath;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Initialise: load mcp.json, spawn all configured servers, discover tools.
   * Safe to call multiple times (restarts servers whose config changed).
   */
  async init(): Promise<void> {
    await this.reload();

    // Lightweight polling to detect mcp.json changes
    this.pollTimer = setInterval(() => {
      this.checkConfigChanged().catch((e) => console.warn('[mcp] poll error:', e.message));
    }, CONFIG_POLL_INTERVAL_MS);
  }

  /** Cleanly shut down all servers and stop polling. */
  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    for (const rt of this.runtimes.values()) {
      this.killRuntime(rt);
    }
    this.runtimes.clear();
    this.tools = [];
  }

  // ── State ─────────────────────────────────────────────────────────────────

  getState(): McpState {
    const order = new Map(this.configOrder.map((id, index) => [id, index]));
    const servers = [...this.runtimes.values()]
      .sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER))
      .map((rt) => ({
        id: rt.id,
        label: rt.label,
        status: rt.status,
        error: rt.error,
      }));
    return {
      servers,
      tools: this.tools,
      lastLoaded: this.lastLoaded,
    };
  }

  onStateChange(cb: () => void): void {
    this.onChangeCb = cb;
  }

  private notifyChange(): void {
    if (this.disposed) return;
    this.onChangeCb?.();
  }

  // ── Configuration loading ─────────────────────────────────────────────────

  /** Absolute path of the mcp.json file backing this manager. */
  getConfigPath(): string {
    return this.jsonPath;
  }

  /** Raw text of mcp.json, or an empty config document when it is missing. */
  readConfigText(): string {
    try {
      return fs.readFileSync(this.jsonPath, 'utf8');
    } catch {
      return JSON.stringify({ mcpServers: {} }, null, 2);
    }
  }

  /** Atomically replace mcp.json. Callers are responsible for validation. */
  saveConfigText(text: string): void {
    writeTextAtomic(this.jsonPath, text);
  }

  private readConfig(): Map<string, McpServerConfig> {
    const map = new Map<string, McpServerConfig>();
    try {
      const raw = fs.readFileSync(this.jsonPath, 'utf8');
      const hash = simpleHash(raw);
      const parsed = JSON.parse(raw) as { mcpServers?: Record<string, McpServerConfig> };
      const servers = parsed.mcpServers ?? {};
      for (const [id, cfg] of Object.entries(servers)) {
        if (cfg && typeof cfg.command === 'string') {
          map.set(id, {
            command: cfg.command,
            args: cfg.args ?? [],
            env: cfg.env ?? {},
            cwd: cfg.cwd,
          });
        }
      }
      this.configOrder = [...map.keys()];
      this.lastConfigHash = hash;
    } catch {
      // Missing or corrupt file → empty config
    }
    return map;
  }

  private async checkConfigChanged(): Promise<void> {
    try {
      const raw = fs.readFileSync(this.jsonPath, 'utf8');
      const hash = simpleHash(raw);
      if (hash !== this.lastConfigHash) {
        console.log('[mcp] config changed, reloading…');
        await this.reload();
      }
    } catch {
      // File disappeared → clear all
      if (this.lastConfigHash !== '') {
        console.log('[mcp] mcp.json removed, clearing servers');
        this.lastConfigHash = '';
        for (const rt of this.runtimes.values()) this.killRuntime(rt);
        this.runtimes.clear();
        this.tools = [];
        this.notifyChange();
      }
    }
  }

  /** Full reload: kill old servers, spawn new ones, discover tools. */
  async reload(): Promise<void> {
    if (this.disposed) return;

    const desired = this.readConfig();

    // Kill servers that are gone or changed
    for (const [id, rt] of this.runtimes) {
      const newCfg = desired.get(id);
      if (!newCfg) {
        this.killRuntime(rt);
        this.runtimes.delete(id);
      } else if (configChanged(rt.config, newCfg)) {
        this.killRuntime(rt);
        this.runtimes.delete(id);
      }
    }

    // Spawn new / restarted servers
    const spawnPromises: Promise<void>[] = [];
    for (const [id, cfg] of desired) {
      if (!this.runtimes.has(id)) {
        spawnPromises.push(this.spawnAndInit(id, cfg));
      }
    }
    await Promise.all(spawnPromises);

    // Rebuild tools list from all ready servers
    this.rebuildTools();
    this.lastLoaded = Date.now();
    this.notifyChange();
  }

  // ── Server spawning & initialization ──────────────────────────────────────

  private async spawnAndInit(id: string, cfg: McpServerConfig): Promise<void> {
    const rt: McpServerRuntime = {
      id,
      label: prettifyServerId(id),
      config: cfg,
      proc: null,
      status: 'spawning',
      error: null,
      nextRequestId: 1,
      pending: new Map(),
      stdoutBuf: '',
      stderrLines: [],
    };
    this.runtimes.set(id, rt);
    this.notifyChange();

    try {
      const env = { ...process.env, ...cfg.env };
      const proc = spawn(cfg.command, cfg.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        cwd: cfg.cwd,
      });
      rt.proc = proc;

      // Capture stderr for diagnostics
      proc.stderr.on('data', (chunk: Buffer) => {
        const line = chunk.toString().trimEnd();
        if (line) {
          rt.stderrLines.push(line);
          if (rt.stderrLines.length > MCP.stderrTailLimit) rt.stderrLines.shift();
        }
      });

      // Stdout: accumulate and dispatch NDJSON lines
      proc.stdout.on('data', (chunk: Buffer) => {
        rt.stdoutBuf += chunk.toString();
        let nlIdx: number;
        while ((nlIdx = rt.stdoutBuf.indexOf('\n')) >= 0) {
          const line = rt.stdoutBuf.slice(0, nlIdx).trim();
          rt.stdoutBuf = rt.stdoutBuf.slice(nlIdx + 1);
          if (!line) continue;
          try {
            const msg = JSON.parse(line) as JsonRpcResponse;
            this.handleResponse(rt, msg);
          } catch {
            // Non-JSON line (log output, etc.) — ignore
          }
        }
      });

      // Unexpected exit
      proc.on('close', (code) => {
        if (this.disposed) return;
        if (rt.status !== 'dead' && rt.status !== 'error') {
          rt.status = 'dead';
          rt.error = `Exited unexpectedly (code ${code})`;
          console.warn(`[mcp] server '${id}' exited unexpectedly (code ${code})`);
          this.cleanupPending(rt);
          this.rebuildTools();
          this.notifyChange();
        }
      });

      proc.on('error', (err) => {
        rt.status = 'error';
        rt.error = err.message;
        console.error(`[mcp] spawn error for '${id}':`, err.message);
        this.rebuildTools();
        this.notifyChange();
      });

      // Perform initialize handshake
      rt.status = 'initializing';
      this.notifyChange();

      const initResp = await this.sendRequest(rt, 'initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
      }, INIT_TIMEOUT_MS);

      // Verify result
      if (initResp.error) {
        throw new Error(initResp.error.message);
      }

      // Send notifications/initialized (fire-and-forget)
      this.sendNotification(rt, 'notifications/initialized', {});

      rt.status = 'ready';
      rt.error = null;
      console.log(`[mcp] server '${id}' ready`);
      this.rebuildTools();
      this.notifyChange();

    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      rt.status = 'error';
      rt.error = errMsg;
      console.error(`[mcp] failed to initialise '${id}': ${errMsg}`);
      this.killRuntime(rt);
      this.notifyChange();
    }
  }

  private killRuntime(rt: McpServerRuntime): void {
    rt.status = 'dead';
    this.cleanupPending(rt);
    if (rt.proc) {
      try { rt.proc.stdin.end(); } catch { /* ignore */ }
      try { rt.proc.kill('SIGTERM'); } catch { /* ignore */ }
      const p = rt.proc;
      setTimeout(() => {
        try { p.kill('SIGKILL'); } catch { /* ignore */ }
      }, MCP.killGraceMs);
      rt.proc = null;
    }
  }

  private cleanupPending(rt: McpServerRuntime): void {
    for (const [, pr] of rt.pending) {
      clearTimeout(pr.timer);
      pr.reject(new Error('Server disconnected'));
    }
    rt.pending.clear();
  }

  // ── JSON-RPC messaging ────────────────────────────────────────────────────

  private sendRequest(
    rt: McpServerRuntime,
    method: string,
    params: unknown,
    timeoutMs: number,
  ): Promise<JsonRpcResponse> {
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      if (!rt.proc) { reject(new Error('No process')); return; }

      const id = rt.nextRequestId++;
      const msg: JsonRpcRequest = { jsonrpc: '2.0', id, method, params };
      const line = JSON.stringify(msg) + '\n';

      const timer = setTimeout(() => {
        rt.pending.delete(id);
        reject(new Error(`Timed out waiting for response to '${method}'`));
      }, timeoutMs);

      rt.pending.set(id, { resolve, reject, timer });

      try {
        rt.proc.stdin.write(line);
      } catch (e) {
        clearTimeout(timer);
        rt.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  private sendNotification(rt: McpServerRuntime, method: string, params?: unknown): void {
    if (!rt.proc) return;
    const msg: JsonRpcNotification = { jsonrpc: '2.0', method, params };
    try { rt.proc.stdin.write(JSON.stringify(msg) + '\n'); } catch { /* ignore */ }
  }

  private handleResponse(rt: McpServerRuntime, msg: JsonRpcResponse): void {
    if (msg.id == null) return;
    const pending = rt.pending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    rt.pending.delete(msg.id);
    pending.resolve(msg);
  }

  // ── Tool discovery ────────────────────────────────────────────────────────

  private rebuildTools(): void {
    // Drop tools belonging to non-ready servers immediately
    this.tools = this.tools.filter((t) => {
      const rt = this.runtimes.get(t.serverId);
      return rt && rt.status === 'ready';
    });

    // Async-discover tools from all ready servers
    for (const rt of this.runtimes.values()) {
      if (rt.status !== 'ready') continue;
      this.discoverFromServer(rt).then((defs) => {
        if (this.disposed) return;
        this.tools = this.tools.filter((t) => t.serverId !== rt.id);
        this.tools.push(...defs);
        this.notifyChange();
      }).catch((e: Error) => {
        console.warn(`[mcp] tools/list failed for '${rt.id}':`, e.message);
      });
    }
  }

  private async discoverFromServer(rt: McpServerRuntime): Promise<McpToolDef[]> {
    const resp = await this.sendRequest(rt, 'tools/list', {}, CALL_TIMEOUT_MS);
    if (resp.error) throw new Error(resp.error.message);
    const result = resp.result as {
      tools?: Array<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>;
    } | undefined;
    const toolsArr = result?.tools ?? [];
    return toolsArr.map((t) => ({
      id: `${rt.id}:${t.name}`,
      serverId: rt.id,
      name: t.name,
      description: t.description ?? '',
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
    }));
  }

  // ── Tool execution ────────────────────────────────────────────────────────

  async callTool(params: McpToolCallParams): Promise<McpToolCallResult> {
    const rt = this.runtimes.get(params.serverId);
    if (!rt) throw new Error(`Unknown MCP server: ${params.serverId}`);
    if (rt.status !== 'ready') throw new Error(`MCP server '${params.serverId}' is not ready (status: ${rt.status})`);

    const resp = await this.sendRequest(rt, 'tools/call', {
      name: params.toolName,
      arguments: params.arguments,
    }, CALL_TIMEOUT_MS);

    if (resp.error) {
      return {
        content: [{ type: 'text', text: `MCP error: ${resp.error.message}` }],
        isError: true,
      };
    }

    const result = resp.result as {
      content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      isError?: boolean;
    } | undefined;

    return {
      content: result?.content ?? [],
      isError: result?.isError ?? false,
    };
  }

  // ── Lookup helpers ────────────────────────────────────────────────────────


}

// ─── Utilities ──────────────────────────────────────────────────────────────

function simpleHash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function configChanged(a: McpServerConfig, b: McpServerConfig): boolean {
  if (a.command !== b.command) return true;
  if (JSON.stringify(a.args) !== JSON.stringify(b.args)) return true;
  if (JSON.stringify(a.env) !== JSON.stringify(b.env)) return true;
  if (a.cwd !== b.cwd) return true;
  return false;
}

function prettifyServerId(id: string): string {
  return id
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
