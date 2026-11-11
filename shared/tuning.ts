import type { ModelTuning, ServeOptions } from './types.js';

/**
 * Canonical tuning defaults (mirrors the reference connector). They are used
 * both as UI fallbacks and as the values sent when a field is left empty.
 */
export const TUNING_DEFAULTS = {
  customSampling: false,
  systemPrompt: '',
  temperature: 1.0,
  topK: 20,
  topP: 0.95,
  minP: 0,
  presencePenalty: 0,
  frequencyPenalty: 0,
  repetitionPenalty: 1,
  seed: -1,
  maxTokens: 4000,
  thinkingTokenBudget: -1,
  toolChoice: true,
  toolApproval: true,
  parallelToolCalls: false,
  priority: 'normal' as const,
  timeout: 0,
  maxRetries: 3,
} as const;

/**
 * Shared numeric bounds for tuning inputs. Keep these values aligned with the
 * Splash launch-option presets so an inherited value is always editable here.
 */
export const TUNING_LIMITS = {
  thinkingTokenBudget: { min: -1, max: 128000 },
  timeout: { min: 0, max: 3600 },
  maxRetries: { min: 0, max: 5 },
} as const;

export interface EffectiveTuning {
  customSampling: boolean;
  systemPrompt: string;
  temperature: number;
  topK: number;
  topP: number;
  minP: number;
  presencePenalty: number;
  frequencyPenalty: number;
  repetitionPenalty: number;
  seed: number;
  maxTokens: number;
  thinkingTokenBudget: number;
  toolChoice: boolean;
  toolApproval: boolean;
  parallelToolCalls: boolean;
  priority: 'foreground' | 'normal' | 'background';
  timeout: number;
  maxRetries: number;
}

/** Parses a Splash-style duration (`90s`, `5m`, `1h`) into seconds. */
export function parseDurationSeconds(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? raw : null;
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;
  const match = value.match(/^(\d+(?:\.\d+)?)\s*([smh]?)$/);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;
  const multiplier = match[2] === 'h' ? 3600 : match[2] === 'm' ? 60 : 1;
  return amount * multiplier;
}

function numericOption(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : null;
}

/** True when a field is explicitly stored in the tuning profile. */
export function isTuningOverride<K extends keyof ModelTuning>(
  tuning: ModelTuning | null | undefined,
  key: K,
): boolean {
  const value = tuning?.[key];
  return value !== undefined && value !== '';
}

/**
 * Resolves a partial tuning profile into a complete one.
 *
 * `thinkingTokenBudget`, `timeout` and `maxRetries` are global settings. When
 * the user has not overridden them, their defaults are inherited from the
 * existing global variables (`options.thinkingTokenBudget` and
 * `options.requestTimeout`) whenever those are set.
 */
export function effectiveTuning(
  tuning: ModelTuning | null | undefined,
  options?: ServeOptions | null,
): EffectiveTuning {
  const t = tuning ?? {};
  const budgetFromServe = numericOption(options?.thinkingTokenBudget);
  const timeoutFromServe = parseDurationSeconds(options?.requestTimeout);

  return {
    customSampling: t.customSampling ?? TUNING_DEFAULTS.customSampling,
    systemPrompt: t.systemPrompt ?? TUNING_DEFAULTS.systemPrompt,
    temperature: t.temperature ?? TUNING_DEFAULTS.temperature,
    topK: t.topK ?? TUNING_DEFAULTS.topK,
    topP: t.topP ?? TUNING_DEFAULTS.topP,
    minP: t.minP ?? TUNING_DEFAULTS.minP,
    presencePenalty: t.presencePenalty ?? TUNING_DEFAULTS.presencePenalty,
    frequencyPenalty: t.frequencyPenalty ?? TUNING_DEFAULTS.frequencyPenalty,
    repetitionPenalty: t.repetitionPenalty ?? TUNING_DEFAULTS.repetitionPenalty,
    seed: t.seed ?? TUNING_DEFAULTS.seed,
    maxTokens: t.maxTokens ?? TUNING_DEFAULTS.maxTokens,
    thinkingTokenBudget: t.thinkingTokenBudget ?? budgetFromServe ?? TUNING_DEFAULTS.thinkingTokenBudget,
    toolChoice: t.toolChoice ?? TUNING_DEFAULTS.toolChoice,
    toolApproval: t.toolApproval ?? TUNING_DEFAULTS.toolApproval,
    parallelToolCalls: t.parallelToolCalls ?? TUNING_DEFAULTS.parallelToolCalls,
    priority: t.priority ?? TUNING_DEFAULTS.priority,
    timeout: t.timeout ?? timeoutFromServe ?? TUNING_DEFAULTS.timeout,
    maxRetries: t.maxRetries ?? TUNING_DEFAULTS.maxRetries,
  };
}
