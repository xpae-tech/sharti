import type { AppConfig } from '../config/index.js';

/**
 * Builds the set of browser origins allowed to call the local service.
 * Defaults to the dev server and the backend's own origin; extra origins are
 * supplied through `SHARTI_ALLOWED_ORIGINS` (validated into the config).
 */
export function buildAllowedOrigins(
  cfg: Pick<AppConfig, 'port' | 'frontendPort' | 'allowedOrigins'>,
): ReadonlySet<string> {
  const origins = new Set<string>([
    `http://localhost:${cfg.port}`,
    `http://127.0.0.1:${cfg.port}`,
    `http://localhost:${cfg.frontendPort}`,
    `http://127.0.0.1:${cfg.frontendPort}`,
  ]);
  for (const origin of cfg.allowedOrigins) origins.add(origin);
  return origins;
}

/** True for explicitly allowed origins and any loopback origin. */
export function isAllowedOrigin(origin: string, allowed: ReadonlySet<string>): boolean {
  if (allowed.has(origin)) return true;
  try {
    const u = new URL(origin);
    return (u.protocol === 'http:' || u.protocol === 'https:')
      && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}
