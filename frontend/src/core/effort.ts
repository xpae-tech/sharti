// Reasoning-effort selection shared by the composer and request builder.

import type { ReasoningInfo } from '../types';

/**
 * Validates a stored effort override against the capabilities advertised by
 * the active provider. `none` is always available; an empty string means
 * "provider default" (omit the field).
 */
export function validEffort(eff: ReasoningInfo, chosen: string): string {
  if (!chosen) return '';
  if (chosen === 'none') return 'none';
  if (eff.efforts.length === 0) return '';
  return eff.efforts.includes(chosen) ? chosen : '';
}

/** Resolves the effective effort shown in the menu for an override. */
export function resolveEffort(eff: ReasoningInfo, chosen: string): string {
  const valid = validEffort(eff, chosen);
  if (valid) return valid;
  return !eff.thinks ? 'none' : eff.efforts.length ? (eff.default || '') : '';
}

/** Human-readable menu label for an effort token. */
export function effortTitle(effort: string): string {
  switch (effort) {
    case '': return 'Default';
    case 'on': return 'Thinking';
    case 'none': return 'No Thinking';
    case 'xhigh': return 'Extra High';
    default: return effort ? effort.charAt(0).toUpperCase() + effort.slice(1) : 'Default';
  }
}
