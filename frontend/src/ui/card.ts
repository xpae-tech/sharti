// Shared card building blocks used by every settings-form screen.

import { el, esc } from '../core/dom.js';

/** Activation dot shown next to a setting label. */
export function activeDot(active: boolean): string {
  return active ? '<span class="conn-dot active opt-active-dot"></span>' : '';
}

/** Card header with an optional activation dot. */
export function cardHead(text: string, active = false): HTMLElement {
  const head = el('div', 'card-head');
  head.appendChild(el('div', 'section-title', `${esc(text)}${activeDot(active)}`));
  return head;
}

/** Row divider shared by card sections. */
export function divider(): HTMLElement {
  return el('div', 'row-div');
}
