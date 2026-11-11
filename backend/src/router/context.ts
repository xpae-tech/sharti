import type { AppServices } from '../app-services.js';
import type { ModelsPayload } from '../domain/types.js';
import { minMemory, rankByIds, suggestVariants } from '../domain/catalog.js';
import { discoverInstalledModels } from '../services/model-discovery.js';

export interface RouterContext {
  readonly services: AppServices;
  readonly allowedOrigins: ReadonlySet<string>;
  buildModelsPayload(): ModelsPayload;
  persistApiConns(): void;
}

/** Shared, side-effect-free helpers used by multiple route groups. */
export function createRouterContext(services: AppServices, allowedOrigins: ReadonlySet<string>): RouterContext {
  const { cfg, catalog, prefs, externalApi } = services;

  return {
    services,
    allowedOrigins,
    buildModelsPayload(): ModelsPayload {
      const installed = discoverInstalledModels(cfg.modelsRoot);
      const byId = new Map(installed.map((m) => [m.id, m]));
      const ordered = rankByIds(catalog, installed.map((m) => m.id))
        .map((id) => byId.get(id))
        .filter((m): m is NonNullable<typeof m> => !!m);
      return {
        models: ordered,
        count: ordered.length,
        ramGb: cfg.ramGb,
        minimumMemory: minMemory(catalog),
        suggestions: suggestVariants(catalog, cfg.ramGb),
      };
    },
    persistApiConns(): void {
      prefs.update((p) => {
        p.apiConnections = externalApi.connections;
        p.activeApiId = externalApi.activeId;
      });
    },
  };
}
