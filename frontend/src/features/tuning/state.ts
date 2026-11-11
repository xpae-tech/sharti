// Tuning state helpers: a value is stored only when it differs from the
// resolved default (or when the user typed it explicitly), so settings can
// inherit new defaults instead of pinning old ones.

import { S } from '../../core/state.js';
import { effectiveTuning, isTuningOverride } from '../../../../shared/tuning.js';
import type { ModelTuning } from '../../types';

export function tunedValue<K extends keyof ModelTuning>(key: K): ModelTuning[K] | undefined {
  return S.prefs.tuning?.[key];
}

export function setTunedValue<K extends keyof ModelTuning>(
  key: K,
  value: ModelTuning[K] | undefined,
  /** Store even when the value equals the resolved default (explicit input). */
  force = false,
): void {
  S.prefs.tuning = S.prefs.tuning || {};
  const baseline = effectiveTuning({}, S.prefs.options)[key];
  if (value === undefined || value === '' || (!force && value === baseline)) {
    delete S.prefs.tuning[key];
  } else {
    S.prefs.tuning[key] = value;
  }
}

export function tunedActive(key: keyof ModelTuning): boolean {
  return isTuningOverride(S.prefs.tuning, key);
}

export type ParsedNumber =
  | { kind: 'empty' }
  | { kind: 'invalid' }
  | { kind: 'value'; value: number };

/** Validates a number field against its declared bounds and integer flag. */
export function parseNumberInput(raw: string, def: { min: number; max: number; int?: boolean }): ParsedNumber {
  if (!raw.trim()) return { kind: 'empty' };
  const value = Number(raw);
  const valid = Number.isFinite(value)
    && value >= def.min
    && value <= def.max
    && (!def.int || Number.isInteger(value));
  return valid ? { kind: 'value', value } : { kind: 'invalid' };
}
