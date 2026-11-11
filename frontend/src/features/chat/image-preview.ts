// Image preview modal: full-size image viewer with Finder integration.
// Toolbar: right-aligned buttons (Reveal in Finder + Close) styled like sm-close.

import { api } from '../../core/api.js';
import { UI_TIMING } from '../../core/config.js';

interface PreviewOpts {
  sheetBackdrop: HTMLDivElement;
}

export function createImagePreview(opts: PreviewOpts) {
  let isOpen = false;

  /** Parse chatId and fileName from the image src URL */
  function parseSrc(src: string): { chatId: string; fileName: string } | null {
    const m = src.match(/\/api\/chats\/([^/]+)\/files\/(.+)/);
    if (!m) return null;
    return { chatId: decodeURIComponent(m[1]), fileName: decodeURIComponent(m[2]) };
  }

  function open(src: string): void {
    if (isOpen) close();
    const bd = opts.sheetBackdrop;
    const parsed = parseSrc(src);
    const finderBtn = parsed
      ? `<button class="ip-btn ip-finder" title="Show in Finder"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg><span>Show in Finder</span></button>`
      : '';

    bd.innerHTML = `
      <div class="img-preview-sheet">
        <div class="img-preview-toolbar">
          <span class="ip-spacer"></span>
          ${finderBtn}
          <button class="ip-btn ip-close" title="Close"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>
        </div>
        <div class="img-preview-body">
          <img src="${src}" alt="">
        </div>
      </div>`;
    requestAnimationFrame(() => bd.classList.add('open'));
    isOpen = true;

    (bd.querySelector('.ip-close') as HTMLButtonElement).onclick = close;
    if (parsed) {
      (bd.querySelector('.ip-finder') as HTMLButtonElement).onclick = () => {
        api('POST', `/api/chats/${encodeURIComponent(parsed.chatId)}/files/${encodeURIComponent(parsed.fileName)}/reveal`).catch(() => { });
      };
    }
    bd.onclick = (e: MouseEvent) => { if (e.target === bd) close(); };
    document.addEventListener('keydown', escHandler);
  }

  function close(): void {
    const bd = opts.sheetBackdrop;
    bd.classList.remove('open');
    setTimeout(() => { bd.innerHTML = ''; }, UI_TIMING.overlayCloseMs);
    isOpen = false;
    document.removeEventListener('keydown', escHandler);
  }

  function escHandler(e: KeyboardEvent): void {
    if (e.key === 'Escape') close();
  }

  return { open, close };
}
