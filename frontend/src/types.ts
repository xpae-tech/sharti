// Frontend contracts: shared DTOs are re-exported from /shared so the server
// and the client can never drift apart. Only browser/UI-only shapes live here.

import type {
  ApiCapabilities,
  CatalogEntry,
  Conversation,
  DiscoveredModel,
  DownloadState,
  EngineState,
  ExternalApiPayload,
  Folder,
  McpServerInfo,
  McpToolDef,
  ModelRuntime,
  Prefs,
  ThreadSegment,
} from '../../shared/types.js';

export * from '../../shared/types.js';

// ── Conversations ──────────────────────────────────────────────────────────

export interface ChatSummary {
  id: string;
  name: string;
  updatedAt: number;
  tokenCount: number;
  folderId?: string | null;
}

// ── Draft (pending outgoing message) ───────────────────────────────────────

export interface DraftAttachment {
  file: File;
  /** Data URL used for the composer preview and the inline upload map. */
  dataUrl: string;
}

export interface Draft {
  text: string;
  attachments: DraftAttachment[];
}

/** PDF attachments follow the same upload and preview path as images. */
export function isPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

/** Build the public URL for a chat file. */
export function chatFileUrl(chatId: string, fileName: string): string {
  return `/api/chats/${encodeURIComponent(chatId)}/files/${encodeURIComponent(fileName)}`;
}

// ── Transcript message shapes ──────────────────────────────────────────────

export interface TranscriptFile {
  url: string;
  name: string;
}

export interface TranscriptMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Pre-resolved image URLs (absolute or data:) */
  images: string[];
  /** Pre-resolved non-image attachments (PDF). */
  files?: TranscriptFile[];
  reasoning?: string;
  error?: string | null;
  live?: boolean;
  details?: string;
  service?: string;
  /** Interleaved thread segments (reasoning + tool calls in order) */
  threadSegments?: ThreadSegment[];
}

export interface AskAgainInfo {
  enabled: boolean;
  help: string;
}

export interface TranscriptPage {
  id: string;
  messages: TranscriptMessage[];
  askAgain: AskAgainInfo;
}

// ── Popup item ─────────────────────────────────────────────────────────────

export interface PopupItem {
  id: string;
  title: string;
  badge?: string;
  sep?: boolean;
}

// ── App state ──────────────────────────────────────────────────────────────

export interface AppState {
  settingsOpen: boolean;
  settingsTab: 'connection' | 'tuning' | 'plugins' | 'system';
  serverView: 'method' | 'api' | 'engine';
  externalApi: ExternalApiPayload;
  apiUrlDraft: string;
  apiNameDraft: string;
  apiKeyDraft: string;
  apiModelNameDraft: string;
  apiModelIdDraft: string;
  runtime: ModelRuntime | null;
  blocker: string | null;
  state: EngineState | null;
  download: DownloadState | null;
  models: DiscoveredModel[];
  suggestions: CatalogEntry[];
  ramGb: number;
  prefs: Prefs;
  /** True when the backend holds a Splash API key (never the key itself). */
  splashApiKeySet: boolean;
  chats: ChatSummary[];
  convs: Map<string, Conversation>;
  currentId: string | null;
  draft: Draft;
  drafts: Map<string, Draft>;
  streaming: string | null;
  streamAbort: AbortController | null;
  apiCaps: ApiCapabilities | null;
  advanced: boolean;
  searchQuery: string;
  /** All discovered MCP tools */
  mcpTools: McpToolDef[];
  /** Known MCP servers (from mcp.json) */
  mcpServers: McpServerInfo[];
  /** Currently activated server IDs */
  enabledMcpServers: Set<string>;
  /** Server IDs explicitly disabled by the user */
  disabledMcpServers: Set<string>;
  /** Native tools (sharti-agent) availability & state */
  nativeToolsEnabled: boolean;
  nativeToolsInitialized: boolean;
  /** Available native tool definitions (from backend) */
  nativeToolDefs: McpToolDef[];
  /** All known folders */
  folders: Folder[];
  /** Currently expanded folder IDs */
  expandedFolders: Set<string>;
}

// ── DOM elements ───────────────────────────────────────────────────────────

export interface Elements {
  win: HTMLDivElement;
  newFolderBtn: HTMLButtonElement;
  newChatBtn: HTMLButtonElement;
  settingsGear: HTMLButtonElement;
  settingsModal: HTMLDivElement;
  settingsClose: HTMLButtonElement;
  settingsTabConnection: HTMLButtonElement;
  settingsTabTuning: HTMLButtonElement;
  settingsTabPlugins: HTMLButtonElement;
  settingsTabSystem: HTMLButtonElement;
  smBackdrop: HTMLDivElement;
  serverForm: HTMLDivElement;
  serverScroll: HTMLDivElement;
  controlBar: HTMLDivElement;
  cbMark: HTMLElement;
  cbModel: HTMLDivElement;
  cbDetail: HTMLDivElement;
  cbActions: HTMLDivElement;
  chatSearch: HTMLInputElement;
  convList: HTMLDivElement;
  convStage: HTMLDivElement;
  emptyState: HTMLDivElement;
  emptyMark: HTMLElement;
  emptyHint: HTMLParagraphElement;
  toolsBar: HTMLDivElement;
  composerInput: HTMLTextAreaElement;
  attachRow: HTMLDivElement;
  attachPlus: HTMLButtonElement;
  engineSlot: HTMLButtonElement;
  engineMark: HTMLElement;
  engineText: HTMLSpanElement;
  effortMenu: HTMLButtonElement;
  effortLabel: HTMLSpanElement;
  sendBtn: HTMLButtonElement;
  sheetBackdrop: HTMLDivElement;
  toast: HTMLDivElement;
}
