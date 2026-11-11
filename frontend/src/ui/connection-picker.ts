// Connection picker shared by the control bar and the composer. Both surfaces
// expose the same API ⇄ Engine switch, so the item list and the preference
// mutation live in one place.

import { S, apiName, connectionMode, nameOf } from '../core/state.js';
import { openPopup } from './popup.js';
import type { PopupItem } from '../types';

export type ConnectionTarget = 'api' | 'engine';

/** Connection targets currently available to route a request to. */
export function connectionTargets(): ConnectionTarget[] {
  const targets: ConnectionTarget[] = [];
  if (S.externalApi.connected) targets.push('api');
  const phase = S.state?.phase;
  if (phase === 'ready' || phase === 'starting' || phase === 'stopping') targets.push('engine');
  return targets;
}

export function connectionLabel(target: ConnectionTarget): string {
  if (target === 'api') return apiName();
  return S.state?.model ? nameOf(S.state.model) : 'Splash Engine';
}

export function connectionItems(): PopupItem[] {
  const mode = connectionMode();
  return connectionTargets().map((id) => ({
    id,
    title: connectionLabel(id),
    badge: id === 'api'
      ? (mode !== 'engine' ? '\u25cf Active' : '')
      : (mode === 'engine' ? '\u25cf Active' : ''),
  }));
}

/** Sets the routing preference; 'api' keeps auto mode so a live engine wins. */
export function selectConnection(target: ConnectionTarget): void {
  S.prefs.connectionMode = target === 'api' ? 'auto' : 'engine';
}

export function openConnectionPicker(
  anchor: HTMLElement,
  onPick: (target: ConnectionTarget) => void,
): void {
  openPopup(anchor, connectionItems(), (id) => onPick(id === 'engine' ? 'engine' : 'api'), true);
}

/** Connecting/activating an external API implicitly leaves an engine pin. */
export function preferExternalConnection(): boolean {
  if (S.prefs.connectionMode !== 'engine') return false;
  S.prefs.connectionMode = 'auto';
  return true;
}
