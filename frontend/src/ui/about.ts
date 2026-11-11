// About Sharti dialog

import { esc } from '../core/dom.js';
import { UI_TIMING } from '../core/config.js';

export function openAbout(sheetBackdrop: HTMLDivElement, version: string): void {
  const bd = sheetBackdrop;
  bd.innerHTML = `
    <div class="sheet about-sheet" role="dialog" aria-modal="true" aria-label="About Sharti">
      <div class="about-content">
        <div class="about-brand">
          <img class="about-logo" src="/assets/xpae-logo.svg" alt="Sharti" />
          <span class="app-version">${esc(version)}</span>
        </div>
        <p class="about-description">Sharti is a private client for working with AI models through Splash Engine and any OpenAI-compatible API.</p>
      </div>
      <div class="sheet-bar about-bar">
        <div class="about-footer">
          <button class="btn prominent" type="button" data-ok>Thanks</button>
          <p class="about-signature">Made by Aleksandr Xpae: by a human, for humans.</p>
        </div>
      </div>
    </div>`;
  requestAnimationFrame(() => bd.classList.add('open'));

  const close = (): void => {
    bd.classList.remove('open');
    setTimeout(() => { bd.innerHTML = ''; }, UI_TIMING.overlayCloseMs);
  };
  bd.onclick = (e: MouseEvent) => { if (e.target === bd) close(); };
  const ok = bd.querySelector('[data-ok]') as HTMLButtonElement | null;
  if (ok) ok.onclick = close;
}
