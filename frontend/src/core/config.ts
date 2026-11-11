/**
 * Frontend runtime knobs. Keep user-configurable values in `Prefs` (persisted
 * by the backend) and code-level limits/timings here so they are not scattered
 * across feature modules.
 */

import { TUNING_LIMITS } from '../../../shared/tuning.js';

/** Chat-completion request behavior. */
export const REQUEST = {
  /** Upper bound on tool-call rounds in one assistant turn. */
  maxToolRounds: 100,
  /** Upper bound the UI accepts for the user's `maxRetries` setting. */
  maxRetries: TUNING_LIMITS.maxRetries.max,
  /** Upstream statuses worth retrying instead of surfacing immediately. */
  retryableStatuses: new Set([408, 425, 429, 500, 502, 503, 504]),
  /** Exponential backoff base for retryable failures. */
  retryBaseDelayMs: 1_000,
  /** Exponential backoff ceiling for retryable failures. */
  retryMaxDelayMs: 10_000,
} as const;

/** Streaming/rendering safeguards. */
export const STREAM = {
  /** Consecutive renderer failures before the live message shows an error. */
  paintFailureLimit: 12,
  /** Message returned to the model when the user rejects a tool call. */
  cancelledToolMessage: 'User cancelled tool call',
} as const;

/** Context-window badge behavior. */
export const CONTEXT = {
  /**
   * Fraction of the model's advertised context window at which the sidebar
   * badge turns critical (0.8 = 80%). Change this to tune the warning globally.
   */
  criticalThreshold: 0.8,
} as const;

/** Shared UI timings (animations, feedback, focus). */
export const UI_TIMING = {
  toastVisibleMs: 2_200,
  toastFadeMs: 200,
  overlayCloseMs: 180,
  focusDelayMs: 60,
  switchFallbackMs: 320,
  copyFeedbackMs: 1_500,
  thinkingTickMs: 500,
  scrollAnimationMs: 400,
  bottomTolerancePx: 50,
  programmaticScrollMs: 100,
} as const;
