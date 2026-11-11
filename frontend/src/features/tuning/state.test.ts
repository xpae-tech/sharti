import { beforeEach, describe, expect, it } from 'vitest';
import { S } from '../../core/state.js';
import { effectiveTuning } from '../../../../shared/tuning.js';
import { parseNumberInput, setTunedValue, tunedActive, tunedValue } from './state.js';

beforeEach(() => {
  S.prefs.tuning = {};
});

describe('tunedValue / setTunedValue', () => {
  it('reads and writes explicit overrides', () => {
    setTunedValue('temperature', 1.4, true);
    expect(tunedValue('temperature')).toBe(1.4);
    expect(tunedActive('temperature')).toBe(true);
  });

  it('removes a value that matches the resolved default', () => {
    const baseline = effectiveTuning({}, S.prefs.options).temperature;
    setTunedValue('temperature', baseline);
    expect(tunedValue('temperature')).toBeUndefined();
    expect(tunedActive('temperature')).toBe(false);
  });

  it('stores a matching value when forced (explicit user input)', () => {
    const baseline = effectiveTuning({}, S.prefs.options).temperature;
    setTunedValue('temperature', baseline, true);
    expect(tunedValue('temperature')).toBe(baseline);
  });

  it('clears on undefined or an empty string', () => {
    setTunedValue('temperature', 1.4, true);
    setTunedValue('temperature', undefined);
    expect(tunedValue('temperature')).toBeUndefined();

    setTunedValue('systemPrompt', 'hello', true);
    setTunedValue('systemPrompt', '');
    expect(tunedValue('systemPrompt')).toBeUndefined();
  });
});

describe('parseNumberInput', () => {
  const def = { min: 0, max: 2, int: false };

  it('distinguishes empty, invalid and valid input', () => {
    expect(parseNumberInput('  ', def)).toEqual({ kind: 'empty' });
    expect(parseNumberInput('abc', def)).toEqual({ kind: 'invalid' });
    expect(parseNumberInput('-1', def)).toEqual({ kind: 'invalid' });
    expect(parseNumberInput('3', def)).toEqual({ kind: 'invalid' });
    expect(parseNumberInput('1.5', def)).toEqual({ kind: 'value', value: 1.5 });
  });

  it('enforces integer bounds', () => {
    const intDef = { min: 0, max: 10, int: true };
    expect(parseNumberInput('2.5', intDef)).toEqual({ kind: 'invalid' });
    expect(parseNumberInput('2', intDef)).toEqual({ kind: 'value', value: 2 });
  });
});
