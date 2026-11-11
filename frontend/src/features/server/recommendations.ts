import type { CatalogEntry } from '../../types';

/** Curated first-run recommendations, in display order. */
const RECOMMENDED_MODEL_NAMES = ['Qwen3.8-27B', 'Qwen3.6-35B-A3B'];

/**
 * Filters the RAM-aware suggestions down to the curated list, preserving the
 * order above and dropping everything else.
 */
export function pickRecommendations(suggestions: CatalogEntry[]): CatalogEntry[] {
  const byName = new Map(suggestions.map((entry) => [entry.name, entry]));
  return RECOMMENDED_MODEL_NAMES.flatMap((name) => {
    const entry = byName.get(name);
    return entry ? [entry] : [];
  });
}
