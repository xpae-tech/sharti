import { describe, expect, it } from 'vitest';
import { ExternalApiState } from './app-services.js';
import type { ApiConnection } from './domain/types.js';

describe('ExternalApiState', () => {
  it('normalizes connections saved before the model/key fields existed', () => {
    const legacy = [{ id: '1', name: 'Old', baseUrl: 'https://example.com' }] as unknown as ApiConnection[];
    const state = new ExternalApiState(legacy);
    state.activeId = '1';

    expect(state.payload().active).toEqual({
      id: '1',
      name: 'Old',
      baseUrl: 'https://example.com',
      apiKey: '',
      hasApiKey: false,
      modelName: '',
      modelId: '',
    });
  });

  it('exposes active connection fields without leaking the key', () => {
    const state = new ExternalApiState([{
      id: '1', name: 'Work', baseUrl: 'https://example.com',
      apiKey: 'secret', modelName: 'GPT-4o', modelId: 'gpt-4o',
    }]);
    expect(state.payload().active).toBeNull();
    state.activeId = '1';
    expect(state.payload().active).toMatchObject({
      apiKey: '',
      hasApiKey: true,
      modelName: 'GPT-4o',
      modelId: 'gpt-4o',
    });
    expect(state.connections[0].apiKey).toBe('secret');
  });
});
