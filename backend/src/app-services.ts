import type { AppConfig } from './config/index.js';
import { redactApiConnection, type ApiConnection, type CatalogEntry } from './domain/types.js';
import type { PreferenceStore } from './domain/preferences.js';
import type { SseHub } from './infra/sse-hub.js';
import type { EngineManager } from './services/engine-manager.js';
import type { DownloadManager } from './services/download-manager.js';
import type { ConversationStore } from './services/conversation-store.js';
import type { FolderStore } from './services/folder-store.js';
import type { McpManager } from './services/mcp-manager.js';
import type { NativeToolsManager } from './services/native-tools.js';

/** Everything a route needs, assembled once in the composition root. */
export interface AppServices {
  readonly cfg: AppConfig;
  readonly catalog: CatalogEntry[];
  readonly prefs: PreferenceStore;
  readonly sse: SseHub;
  readonly engine: EngineManager;
  readonly downloader: DownloadManager;
  readonly conversations: ConversationStore;
  readonly folders: FolderStore;
  readonly externalApi: ExternalApiState;
  readonly mcp: McpManager;
  readonly nativeTools: NativeToolsManager;
}

/** In-memory state for saved external API connections. */
export class ExternalApiState {
  connections: ApiConnection[] = [];
  activeId: string | null = null;

  constructor(initial: ApiConnection[]) {
    this.connections = initial.map((c) => ({
      ...c,
      apiKey: c.apiKey ?? '',
      modelName: c.modelName ?? '',
      modelId: c.modelId ?? '',
    }));
  }

  payload() {
    const ac = this.connections.find((c) => c.id === this.activeId) ?? null;
    return {
      connections: this.connections.map(redactApiConnection),
      activeId: this.activeId,
      active: ac ? redactApiConnection(ac) : null,
      connected: !!ac,
    };
  }
}
