import { CONTEXT } from './config.js';
import { contextFigure, formatTokenBadge } from './format.js';

export interface ContextBadgeInfo {
  label: string;
  critical: boolean;
  tooltip: string;
}

/**
 * Builds the sidebar context badge. `tokens` is the last reported context
 * occupancy; `limit` is the maximum advertised by the active service (null when
 * the provider does not expose it). The critical threshold is configured in
 * `core/config.ts` (`CONTEXT.criticalThreshold`).
 */
export function contextBadgeInfo(tokens: number, limit: number | null): ContextBadgeInfo | null {
  const label = formatTokenBadge(tokens);
  if (!label) return null;

  const knownLimit = limit != null && limit > 0;
  const critical = knownLimit && tokens / limit >= CONTEXT.criticalThreshold;
  const tooltip = knownLimit
    ? `Context is ${Math.round((tokens / limit) * 100)}% full (${contextFigure(tokens)} of ${contextFigure(limit)} tokens)`
    : `Context: ${contextFigure(tokens)} tokens`;

  return { label, critical, tooltip };
}
