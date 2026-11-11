// Popup menu primitive (dropdown anchored to a trigger element)

import { el, esc } from '../core/dom.js';
import type { PopupItem } from '../types';

let openPop: (HTMLElement & { _cleanup?: () => void }) | null = null;
let openAnchor: HTMLElement | null = null;

export function openPopup(
  anchor: HTMLElement,
  items: PopupItem[],
  onPick: (id: string) => void,
  above?: boolean
): void {
  // Clicking the same trigger again toggles the menu closed.
  if (openPop && openAnchor === anchor) {
    closePopup();
    return;
  }
  closePopup();

  const pop = el('div', 'popup') as HTMLElement & { _cleanup?: () => void };
  items.forEach((it) => {
    if (it.sep) { pop.appendChild(el('div', 'popup-sep')); return; }
    const bi = el('button', 'popup-item');
    bi.innerHTML = `<span class="chk"></span><span>${esc(it.title)}</span>`;
    if (it.badge) bi.appendChild(el('span', 'badge', esc(it.badge)));
    bi.onclick = () => { closePopup(); onPick(it.id); };
    pop.appendChild(bi);
  });
  document.body.appendChild(pop);

  const r = anchor.getBoundingClientRect();
  const pw = pop.offsetWidth;
  const ph = pop.offsetHeight;
  const left = clampNum(r.left, 8, window.innerWidth - pw - 8);
  let top = above ? r.top - ph - 6 : r.bottom + 6;
  if (above && top < 8) top = r.bottom + 6;
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';
  requestAnimationFrame(() => pop.classList.add('open'));
  openPop = pop;
  openAnchor = anchor;

  const closeEv = (e: MouseEvent) => {
    const target = e.target as Node;
    if (!pop.contains(target) && !anchor.contains(target)) closePopup();
  };
  setTimeout(() => document.addEventListener('mousedown', closeEv), 0);
  pop._cleanup = () => document.removeEventListener('mousedown', closeEv);
}

export function closePopup(): void {
  if (openPop) {
    openPop._cleanup?.();
    openPop.remove();
    openPop = null;
  }
  openAnchor = null;
}

const clampNum = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
