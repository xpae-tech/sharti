import { describe, expect, it } from 'vitest';
import {
  displayName,
  minMemory,
  modelName,
  rankByIds,
  suggestVariants,
} from './catalog.js';
import { modelVariant } from '../../../shared/model-id.js';
import type { CatalogEntry } from './types.js';

const catalog: CatalogEntry[] = [
  { id: 'org/a:q2', name: 'A', memory: 16, size: 8, about: 'small' },
  { id: 'org/a:q4', name: 'A', memory: 32, size: 16, about: 'large' },
  { id: 'org/b', name: 'B', memory: 24, size: 12, about: 'mid' },
];

describe('catalog', () => {
  it('picks the strongest variant that fits RAM', () => {
    expect(suggestVariants(catalog, 24).map((v) => v.id)).toEqual(['org/a:q2', 'org/b']);
  });

  it('returns the minimum memory', () => {
    expect(minMemory(catalog)).toBe(16);
  });

  it('derives display names and variants', () => {
    expect(modelName('org/a:q4', catalog)).toBe('A');
    expect(modelVariant('org/a:q4')).toBe('q4');
    expect(displayName('org/a:q4', catalog)).toBe('A (q4)');
  });

  it('ranks known ids first and then lexicographically', () => {
    expect(rankByIds(catalog, ['zzz', 'org/a:q4', 'org/b'])).toEqual([
      'org/a:q4',
      'org/b',
      'zzz',
    ]);
  });
});
