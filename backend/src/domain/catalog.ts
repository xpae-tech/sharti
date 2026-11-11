import fs from 'node:fs';
import type { CatalogEntry } from './types.js';
import { modelDisplayName, modelVariant } from '../../../shared/model-id.js';

// ─── Fallback Catalog ───────────────────────────────────────────────────────

const FALLBACK_CATALOG: CatalogEntry[] = [
  { id: 'unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M', name: 'Qwen3.6-35B-A3B', memory: 36, size: 24, about: 'Fast all-rounder' },
  { id: 'mlx-community/Qwen3.6-35B-A3B-4bit', name: 'Qwen3.6-35B-A3B', memory: 36, size: 21, about: 'Fast all-rounder' },
  { id: 'unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q2_K_XL', name: 'Qwen3.6-35B-A3B', memory: 24, size: 14, about: 'Fast all-rounder' },
  { id: 'unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M', name: 'Qwen3.8-27B', memory: 36, size: 21, about: 'Strongest at this size, slower' },
  { id: 'mlx-community/Qwen3.8-27B-4bit', name: 'Qwen3.8-27B', memory: 36, size: 20, about: 'Strongest at this size, slower' },
  { id: 'unsloth/Qwen3.8-27B-GGUF:UD-IQ3_XXS', name: 'Qwen3.8-27B', memory: 24, size: 16, about: 'Strongest at this size, slower' },
  { id: 'ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF:Q2_0', name: 'Qwen3.8-Flash-Next', memory: 64, size: 69, about: 'Most capable' },
  { id: 'unsloth/flint-GGUF:UD-Q4_K_XL', name: 'Flint', memory: 48, size: 26, about: 'Text only' },
  { id: 'unsloth/Ornith-1.5-122B-GGUF:UD-Q4_K_XL', name: 'Ornith-1.5-122B', memory: 128, size: 82, about: 'Largest model' },
  { id: 'ornith-ai/Ornith-1.5-122B-MLX-4bit', name: 'Ornith-1.5-122B', memory: 128, size: 71, about: 'Largest model' },
  { id: 'prism-ml/Ternary-Bonsai-2-27B-gguf:PQ2_0', name: 'Ternary-Bonsai-2-27B', memory: 24, size: 12, about: 'Smallest download' },
];

// ─── Loader ─────────────────────────────────────────────────────────────────

export function loadCatalog(tsvPath: string | null): CatalogEntry[] {
  if (tsvPath && fs.existsSync(tsvPath)) {
    try {
      const text = fs.readFileSync(tsvPath, 'utf8');
      const variants = text.split('\n').flatMap((line) => {
        if (!line || line.startsWith('#')) return [];
        const f = line.split('\t');
        if (f.length !== 5) return [];
        const memory = parseInt(f[2], 10);
        const size = parseInt(f[3], 10);
        if (Number.isNaN(memory) || Number.isNaN(size)) return [];
        return [{ id: f[0], name: f[1], memory, size, about: f[4] }];
      });
      if (variants.length > 0) return variants;
    } catch { /* fall through */ }
  }
  return FALLBACK_CATALOG;
}

// ─── Query Functions ────────────────────────────────────────────────────────

export function suggestVariants(catalog: CatalogEntry[], memoryGb: number): CatalogEntry[] {
  const chosen = new Map<string, CatalogEntry>();
  for (const v of catalog) {
    if (v.memory > memoryGb) continue;
    const cur = chosen.get(v.name);
    if (!cur || v.memory > cur.memory) chosen.set(v.name, v);
  }
  const order: string[] = [];
  for (const v of catalog) {
    if (!order.includes(v.name)) order.push(v.name);
  }
  return order.map((n) => chosen.get(n)!).filter(Boolean);
}

export function minMemory(catalog: CatalogEntry[]): number {
  return Math.min(...catalog.map((v) => v.memory));
}

export function modelName(id: string, catalog: CatalogEntry[]): string {
  if (!id) return '';
  const hit = catalog.find((v) => v.id === id);
  if (hit) return hit.name;
  return modelDisplayName(id);
}


export function displayName(id: string, catalog: CatalogEntry[]): string {
  if (!id) return '';
  const name = modelName(id, catalog);
  const siblings = catalog.filter((v) => modelName(v.id, catalog) === name);
  if (siblings.length <= 1) return name;
  return `${name} (${modelVariant(id)})`;
}

export function rankByIds(catalog: CatalogEntry[], ids: string[]): string[] {
  const catRank = new Map(catalog.map((v, i) => [v.id, i]));
  const rank = (id: string): number => catRank.get(id) ?? Infinity;
  return [...ids].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}
