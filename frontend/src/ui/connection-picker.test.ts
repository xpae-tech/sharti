import { beforeEach, describe, expect, it } from 'vitest';
import { S } from '../core/state.js';
import {
  connectionItems,
  connectionLabel,
  connectionTargets,
  preferExternalConnection,
  selectConnection,
} from './connection-picker.js';

beforeEach(() => {
  S.externalApi = { connections: [], activeId: null, active: null, connected: false };
  S.state = null;
  S.prefs.connectionMode = 'auto';
});

describe('connection picker', () => {
  it('offers only the targets that can currently answer', () => {
    expect(connectionTargets()).toEqual([]);
    S.externalApi = { ...S.externalApi, connected: true };
    expect(connectionTargets()).toEqual(['api']);
    S.state = minimalState('ready');
    expect(connectionTargets()).toEqual(['api', 'engine']);
  });

  it('marks the routed target and keeps auto mode for the external API', () => {
    S.externalApi = {
      connections: [],
      activeId: 'a',
      active: { id: 'a', name: 'Work', baseUrl: 'https://example.com', apiKey: '', modelName: 'GPT-4o', modelId: 'gpt-4o' },
      connected: true,
    };
    S.state = { ...minimalState('ready'), model: 'org/model', modelDisplayName: 'model' };

    expect(connectionItems()).toEqual([
      { id: 'api', title: 'GPT-4o', badge: '\u25cf Active' },
      { id: 'engine', title: 'model', badge: '' },
    ]);

    selectConnection('engine');
    expect(S.prefs.connectionMode).toBe('engine');
    expect(connectionLabel('engine')).toBe('model');
    selectConnection('api');
    expect(S.prefs.connectionMode).toBe('auto');
  });

  it('only clears an engine pin when an external API takes over', () => {
    S.prefs.connectionMode = 'auto';
    expect(preferExternalConnection()).toBe(false);
    S.prefs.connectionMode = 'engine';
    expect(preferExternalConnection()).toBe(true);
    expect(S.prefs.connectionMode).toBe('auto');
  });
});

function minimalState(phase: 'ready' | 'stopped') {
  return {
    phase,
    step: '',
    serving: 'running' as const,
    model: null,
    modelDisplayName: '',
    next: null,
    since: null,
    stepSince: null,
    port: 8000,
    context: null,
    acceptsImages: true,
    reasoning: null,
    memBytes: null,
    failMessage: null,
    status: '',
    markLook: 'off' as const,
    apiAddress: '',
    uptimeSec: null,
  };
}
