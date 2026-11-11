// Sheet (modal overlay) and confirmation dialog primitives

import { $ } from '../core/dom.js';
import { UI_TIMING } from '../core/config.js';

export function openSheet(
  sheetBackdrop: HTMLDivElement,
  innerHTML: string,
  footButtons: string[],
  wireFn: (root: HTMLElement, close: () => void) => void
): void {
  const bd = sheetBackdrop;
  bd.innerHTML = `<div class="sheet">${innerHTML}<div class="sheet-bar" id="__fb">${footButtons.join('')}</div></div>`;
  requestAnimationFrame(() => bd.classList.add('open'));
  const close = () => { bd.classList.remove('open'); setTimeout(() => { bd.innerHTML = ''; }, UI_TIMING.overlayCloseMs); };
  const cancelBtn = $('[data-role="cancel"]', bd);
  if (cancelBtn) cancelBtn.onclick = close;
  bd.onclick = (e: MouseEvent) => { if (e.target === bd) close(); };
  wireFn($('#__fb', bd) as HTMLElement || bd, close);
}

export function openConfirm(
  sheetBackdrop: HTMLDivElement,
  title: string,
  message: string,
  onYes: () => void
): void {
  const bd = sheetBackdrop;
  bd.innerHTML = `<div class="sheet confirm-dialog"><div class="sheet-head">${title}</div><div class="sheet-body">${message}</div><div class="sheet-bar"><button class="btn" data-no>Cancel</button><button class="btn danger" data-yes>Delete</button></div></div>`;
  requestAnimationFrame(() => bd.classList.add('open'));
  const close = () => { bd.classList.remove('open'); setTimeout(() => { bd.innerHTML = ''; }, UI_TIMING.overlayCloseMs); };
  ($('[data-no]', bd) as HTMLButtonElement).onclick = close;
  ($('[data-yes]', bd) as HTMLButtonElement).onclick = () => { close(); onYes(); };
  bd.onclick = (e: MouseEvent) => { if (e.target === bd) close(); };
}
