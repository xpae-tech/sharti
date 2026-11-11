import { describe, expect, it } from 'vitest';
import { pickRecommendations } from './recommendations.js';
import type { CatalogEntry } from '../../types';

const entry = (id: string, name: string): CatalogEntry => ({
  id,
  name,
  memory: 36,
  size: 21,
  about: 'test',
});

describe('pickRecommendations', () => {
  it('keeps only the curated models in the requested order', () => {
    const suggestions = [
      entry('unsloth/Qwen3.6-35B-A3B-GGUF:UD-Q4_K_M', 'Qwen3.6-35B-A3B'),
      entry('unsloth/Ornith-1.5-122B-GGUF:UD-Q4_K_XL', 'Ornith-1.5-122B'),
      entry('unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M', 'Qwen3.8-27B'),
    ];
    expect(pickRecommendations(suggestions).map((s) => s.name)).toEqual([
      'Qwen3.8-27B',
      'Qwen3.6-35B-A3B',
    ]);
  });

  it('omits models that do not fit the current RAM', () => {
    expect(pickRecommendations([entry('unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_M', 'Qwen3.8-27B')]))
      .toHaveLength(1);
  });

  it('returns an empty list when nothing matches', () => {
    expect(pickRecommendations([])).toEqual([]);
  });
});
