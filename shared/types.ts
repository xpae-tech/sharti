// Shared domain contracts used by both the backend and the frontend.
// This file intentionally has no Node.js or DOM dependencies: it is the single
// source of truth for every DTO that crosses the HTTP/SSE boundary.

// ─── Reasoning / capabilities ──────────────────────────────────────────────

export interface ReasoningInfo {
  thinks: boolean;
  efforts: string[];
  default: string | null;
}

export interface ApiCapabilities {
  acceptsImages: boolean;
  context: number | null;
  reasoning: ReasoningInfo | null;
}

// ─── Engine state ──────────────────────────────────────────────────────────

export type EnginePhase = 'stopped' | 'starting' | 'stopping' | 'ready' | 'failed';
export type ServingState = 'running' | 'sleeping' | 'recovering';
export type MarkLook = 'off' | 'loading' | 'on' | 'asleep' | 'failed';

export interface EngineState {
  readonly phase: EnginePhase;
  readonly step: string;
  readonly serving: ServingState;
  readonly model: string | null;
  readonly modelDisplayName: string;
  readonly next: string | null;
  readonly since: number | null;
  readonly stepSince: number | null;
  readonly port: number;
  readonly context: number | null;
  readonly acceptsImages: boolean;
  readonly reasoning: ReasoningInfo | null;
  readonly memBytes: number | null;
  readonly failMessage: string | null;
  readonly status: string;
  readonly markLook: MarkLook;
  readonly apiAddress: string;
  readonly uptimeSec: number | null;
}

// ─── Model catalog & discovery ─────────────────────────────────────────────

export interface CatalogEntry {
  readonly id: string;
  readonly name: string;
  /** GB of RAM required */
  readonly memory: number;
  /** GB to download */
  readonly size: number;
  readonly about: string;
}

export interface DiscoveredModel {
  readonly id: string;
  readonly source: 'splash-installed';
  readonly bytes: number | null;
  readonly path: string;
  readonly missing?: boolean;
}

export interface ModelsPayload {
  readonly models: DiscoveredModel[];
  readonly count: number;
  readonly ramGb: number;
  readonly minimumMemory: number;
  readonly suggestions: CatalogEntry[];
}

// ─── Downloads ─────────────────────────────────────────────────────────────

export interface DownloadProgress {
  readonly done: number;
  readonly total: number;
  readonly fraction: number;
}

export interface DownloadState {
  readonly running: boolean;
  readonly model: string | null;
  readonly progress: DownloadProgress | null;
  readonly remainingSec: number | null;
  /** Instantaneous transfer rate in bytes per second (null while unknown). */
  readonly speedBps: number | null;
  readonly failure: { model: string; message: string } | null;
}

// ─── Conversations ─────────────────────────────────────────────────────────

export interface TextPart {
  type: 'text';
  text: string;
}

export interface ImagePart {
  type: 'image';
  /** filename inside the chat's files/ directory */
  fileName: string;
  mimeType: string;
}

/** A non-image chat attachment, currently a PDF document. */
export interface FilePart {
  type: 'file';
  /** filename inside the chat's files/ directory */
  fileName: string;
  mimeType: string;
  /** Original name shown in the transcript, when known. */
  originalName?: string;
}

export type Part = TextPart | ImagePart | FilePart;

export interface ChatFileMeta {
  fileName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: number;
}

/** Lifecycle of a tool call while the approval mode is active. */
export type ToolApprovalState = 'streaming' | 'pending' | 'correcting' | 'approved' | 'rejected';

/** A single segment in the assistant's reasoning/thread timeline. */
export type ThreadSegment =
  | { kind: 'reasoning'; text: string; stats?: string; startedAt?: number; contentStarted?: boolean }
  | { kind: 'content'; text: string }
  | {
      kind: 'tool';
      serverId: string;
      toolName: string;
      arguments: Record<string, unknown>;
      result: string;
      isError: boolean;
      rawArgs?: string;
      /** Upstream tool_call id, used to route approval decisions. */
      toolCallId?: string;
      /** Present only when tool approval mode handled this call. */
      approval?: ToolApprovalState;
    };

/** Records a single tool invocation made during an agent turn. */
export interface McpToolInvocation {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result: string;
  isError: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: Part[];
  ts: number;
  // Assistant-response enrichment
  reasoning?: string;
  error?: string;
  stopped?: boolean;
  model?: string;
  service?: string;
  tps?: number | null;
  input?: number | null;
  output?: number | null;
  cached?: number | null;
  duration?: number | null;
  reasoningTokens?: number | null;
  /** Legacy: tool invocations performed during this assistant turn */
  toolInvocations?: McpToolInvocation[];
  /** Interleaved thread segments (reasoning + tool calls in chronological order) */
  threadSegments?: ThreadSegment[];
  // Transient UI field (never persisted by the server)
  live?: boolean;
}

export interface Conversation {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  tokenCount: number;
  userLastMessagedAt: number | null;
  assistantLastMessagedAt: number | null;
  messages: ChatMessage[];
  files: ChatFileMeta[];
  /** Optional folder grouping (null = general/unsorted) */
  folderId?: string | null;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

// ─── Preferences ───────────────────────────────────────────────────────────

export interface ApiConnection {
  id: string;
  /** User's label for the connection. */
  name: string;
  /** OpenAI-compatible base URL, without a trailing /v1. */
  baseUrl: string;
  /** Bearer token sent to the external API (empty in redacted payloads). */
  apiKey: string;
  /** True when the server holds a key for this connection (client-safe). */
  hasApiKey?: boolean;
  /** Display name of the model, e.g. "GPT-4o". */
  modelName: string;
  /** Model identifier sent in requests, e.g. "gpt-4o". */
  modelId: string;
}

export interface ServeOptions {
  [key: string]: string | number | boolean | undefined;
  port?: number | string;
  // Network and access
  host?: string;
  allowedHost?: string;
  allowedOrigin?: string;
  apiKey?: string;
  noWebui?: boolean;
  // Memory and context
  maxMemory?: string;
  maxContext?: string;
  pleMemory?: string;
  expertMemory?: string;
  sparseKvMemory?: string;
  kvFormat?: string;
  stateFormat?: string;
  idleRelease?: string;
  // SSD cache
  maxCacheDisk?: string;
  maxCacheDiskWrites?: string;
  persistentCache?: boolean;
  cacheDir?: string;
  // API
  servedModelName?: string;
  announceServedName?: boolean;
  defaultReasoningEffort?: string;
  thinkingTokenBudget?: string;
  thinkingEndText?: string;
  // Requests
  maxRequestSize?: string;
  maxImagePixels?: string;
  requestTimeout?: string;
  queueSize?: string;
  decodeShare?: string;
  disableAne?: boolean;
  verifyRows?: string;
  allowIdleSleep?: boolean;
  // Model selection (per-model)
  languageOnly?: boolean;
  offline?: boolean;
  modelDir?: string;
  mmproj?: string;
  draftModel?: string;
}

/**
 * Fine-grained model tuning shared by every connection method (Splash engine
 * and external OpenAI-compatible APIs). Every field is optional: an unset
 * value is resolved from the defaults in `shared/tuning.ts`, which may in turn
 * inherit from the global `ServeOptions` for the matching server-level knob.
 */
export interface ModelTuning {
  /** Global gate: when off, no tuning attributes beyond the messages and the
   * mandatory connection fields are sent to the provider. */
  customSampling?: boolean;
  /** Optional system instruction prepended to every request. */
  systemPrompt?: string;
  // Sampling
  temperature?: number;
  topK?: number;
  topP?: number;
  minP?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  repetitionPenalty?: number;
  seed?: number;
  maxTokens?: number;
  // Reasoning
  thinkingTokenBudget?: number;
  // Tools
  /** On: attach tools and tool_choice=auto. Off: no tools at all. */
  toolChoice?: boolean;
  /** On: pause before every tool call so the user can accept, reject, or correct it. */
  toolApproval?: boolean;
  parallelToolCalls?: boolean;
  // Request
  /** Splash Engine only; ignored by external APIs. */
  priority?: 'foreground' | 'normal' | 'background';
  /** Client-side request timeout in seconds (0 = no timeout). */
  timeout?: number;
  /** Retry attempts for transient upstream failures (0 to 5). */
  maxRetries?: number;
}

/** Interface colour theme. Dark is the default and matches the original look. */
export type Theme = 'dark' | 'light';

export interface Prefs {
  selectedModel: string | null;
  /** Interface colour theme (persisted with the rest of the preferences). */
  theme: Theme;
  efforts: Record<string, string>;
  options: ServeOptions;
  /** Model tuning applied to every provider (global, not per connection). */
  tuning: ModelTuning;
  connectionMode: 'auto' | 'engine' | 'external';
  apiConnections: ApiConnection[];
  /** Active external API connection ID (restored on boot) */
  activeApiId: string | null;
  /** IDs of MCP servers the user has activated */
  enabledMcpServers: string[];
  /** IDs of MCP servers explicitly disabled by the user */
  disabledMcpServers: string[];
  /** Master switch for the native FS/CLI tool suite (sharti-agent) */
  nativeToolsEnabled: boolean;
  /** Specific native tool names disabled individually */
  disabledNativeTools: string[];
  /**
   * Persist every outgoing LLM request and its full response into the chat's
   * files directory. Off by default: the logs are complete and unbounded.
   */
  llmLogging: boolean;
}

// ─── External API ──────────────────────────────────────────────────────────

export interface ExternalApiPayload {
  readonly connections: ApiConnection[];
  readonly activeId: string | null;
  readonly active: ApiConnection | null;
  readonly connected: boolean;
}

// ─── MCP (Model Context Protocol) ──────────────────────────────────────────

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export type McpServerLifecycle = 'idle' | 'spawning' | 'initializing' | 'ready' | 'error' | 'dead';

export interface McpServerInfo {
  id: string;
  label: string;
  status: McpServerLifecycle;
  error: string | null;
}

export interface McpToolDef {
  /** Unique compound ID: "${serverId}:${toolName}" */
  id: string;
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpState {
  servers: McpServerInfo[];
  tools: McpToolDef[];
  /** Timestamp of last successful config load */
  lastLoaded: number | null;
}

export interface McpToolCallParams {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface McpToolCallResult {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError: boolean;
}

// ─── Native tools (in-process FS & CLI) ────────────────────────────────────

/** Fixed serverId assigned to all native (built-in) tools. */
export const NATIVE_SERVER_ID = 'sharti-agent';

/** State snapshot for the native tools subsystem. */
export interface NativeToolsState {
  /** Enabled tools (individually disabled ones are omitted). Empty when off. */
  tools: McpToolDef[];
  initialized: boolean;
  /** Master switch; authoritative over preferences for UI state. */
  enabled: boolean;
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────

export interface ModelRuntime {
  readonly root: string;
  readonly python: string;
  readonly engine: string | null;
  readonly packaged: boolean;
}

export interface BootstrapResponse {
  readonly runtime: ModelRuntime | null;
  readonly blocker: string | null;
  readonly ramGb: number;
  readonly state: EngineState;
  readonly download: DownloadState;
  readonly prefs: Prefs;
  /** True when the backend holds a Splash API key (never the key itself). */
  readonly splashApiKeySet: boolean;
  readonly models: ModelsPayload;
  readonly externalApi: ExternalApiPayload;
  readonly mcp: McpState;
  readonly nativeTools: NativeToolsState;
}

// ─── Convenience helpers ───────────────────────────────────────────────────

export function getMessageText(m: ChatMessage): string {
  const tp = m.parts.find((p) => p.type === 'text');
  return tp && tp.type === 'text' ? tp.text : '';
}

export function getMessageImages(m: ChatMessage): ImagePart[] {
  return m.parts.filter((p) => p.type === 'image') as ImagePart[];
}

export function getMessageFiles(m: ChatMessage): FilePart[] {
  return m.parts.filter((p) => p.type === 'file') as FilePart[];
}

/**
 * Canonical reasoning text: interleaved reasoning segments when present,
 * otherwise the legacy message-level field. Keeping this derivation in one
 * place lets chat files store a single copy (the segments) without breaking
 * old conversations.
 */
export function getMessageReasoning(m: ChatMessage): string {
  const segments = m.threadSegments;
  if (segments && segments.length > 0) {
    let text = '';
    let fromSegments = false;
    for (const seg of segments) {
      if (seg.kind !== 'reasoning' || !seg.text) continue;
      text += seg.text;
      fromSegments = true;
    }
    if (fromSegments) return text;
  }
  return m.reasoning ?? '';
}

/** Empty download state used by the UI when a download is dismissed. */
export function emptyDownloadState(model: string | null = null): DownloadState {
  return { running: false, model, progress: null, remainingSec: null, speedBps: null, failure: null };
}

/** Fresh preference document shared by the backend store and the UI state. */
export function createDefaultPrefs(): Prefs {
  return {
    selectedModel: null,
    theme: 'dark',
    efforts: {},
    options: {},
    tuning: {},
    connectionMode: 'auto',
    apiConnections: [],
    activeApiId: null,
    enabledMcpServers: [],
    disabledMcpServers: [],
    nativeToolsEnabled: true,
    disabledNativeTools: [],
    llmLogging: false,
  };
}

/**
 * Strips secrets from a connection before it crosses the HTTP boundary.
 * The client only learns whether a key is stored, never the key itself.
 */
export function redactApiConnection(connection: ApiConnection): ApiConnection {
  return {
    ...connection,
    apiKey: '',
    hasApiKey: Boolean(connection.apiKey),
  };
}

/** Client-safe preferences: secrets stay in the backend data directory. */
export function redactPrefs(prefs: Prefs): Prefs {
  const options = { ...prefs.options };
  delete options.apiKey;
  return {
    ...prefs,
    options,
    apiConnections: prefs.apiConnections.map(redactApiConnection),
  };
}
