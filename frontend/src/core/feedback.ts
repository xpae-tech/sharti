// Toast notifications and clipboard helpers.

import { UI_TIMING } from './config.js';

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(msg: string, elRef: HTMLElement): void {
  elRef.textContent = msg;
  elRef.hidden = false;
  requestAnimationFrame(() => elRef.classList.add('show'));
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    elRef.classList.remove('show');
    setTimeout(() => { elRef.hidden = true; }, UI_TIMING.toastFadeMs);
  }, UI_TIMING.toastVisibleMs);
}

export function copyText(t: string): void {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(t).then(() => { /* ok */ }).catch(() => { /* noop */ });
  }
}
