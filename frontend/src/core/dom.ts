// DOM utility helpers

import { UI_TIMING } from './config.js';

export const $ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T | null =>
  root.querySelector(selector) as T | null;

export const el = (tag: string, cls?: string, html?: string): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** Run `done` once the switch knob has finished sliding.
 *
 * Forms are rebuilt from state, so rendering immediately after a click replaces
 * the switch with an already-toggled node and the CSS transition never runs.
 * Defer the rebuild until the transform transition ends (with a timeout as a
 * fallback for interrupted transitions). */
export function afterSwitchSlide(sw: HTMLElement, done: () => void): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    done();
    return;
  }

  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    sw.removeEventListener('transitionend', onEnd);
    done();
  };
  const onEnd = (event: TransitionEvent): void => {
    if (event.target === sw && event.propertyName === 'transform') finish();
  };

  sw.addEventListener('transitionend', onEnd);
  window.setTimeout(finish, UI_TIMING.switchFallbackMs);
}
