// Chat & Folder CRUD: rename, delete, reveal

import { esc, $ } from '../../core/dom.js';
import { S } from '../../core/state.js';
import { api } from '../../core/api.js';
import { UI_TIMING } from '../../core/config.js';
import { openSheet, openConfirm } from '../../ui/sheet.js';
import type { Elements } from '../../types';

interface CrudDeps {
  loadChats: () => Promise<void>;
  renderChatSidebar: () => void;
  renderConversation: () => void;
  restoreDraft: () => void;
  stopStream: () => void;
}

export function createChatCrud(E: Elements, deps: CrudDeps) {
  // ── Chat helpers ──────────────────────────────────────────────────────────

  function chatTitle(id: string): string {
    const conv = S.convs.get(id);
    if (conv && conv.name) return conv.name;
    const sum = S.chats.find((c) => c.id === id);
    return (sum && sum.name) || 'New Chat';
  }

  function renameConversation(id: string): void {
    openSheet(E.sheetBackdrop,
      `<div class="sheet-head">Rename Chat</div><div class="sheet-body"><input class="big" id="rnInput" placeholder="Conversations name" value="${esc(chatTitle(id))}"></div>`,
      [`<button class="btn" data-role="cancel">Cancel</button>`, `<button class="btn prominent" data-role="go">Rename</button>`],
      (root: HTMLElement, close: () => void) => {
        const inp = $('#rnInput', E.sheetBackdrop) as HTMLInputElement;
        const go = () => {
          const t = inp.value.trim();
          api('PATCH', `/api/chats/${encodeURIComponent(id)}`, { name: t }).then(() => {
            const conv = S.convs.get(id);
            if (conv) conv.name = t;
            deps.loadChats().then(() => { deps.renderChatSidebar(); });
            close();
          });
        };
        inp.onkeydown = (e: KeyboardEvent) => { if (e.key === 'Enter') go(); };
        ($('[data-role="go"]', root) as HTMLButtonElement).onclick = go;
        setTimeout(() => { inp.focus(); inp.select(); }, UI_TIMING.focusDelayMs);
      });
  }

  function confirmDelete(id: string): void {
    openConfirm(E.sheetBackdrop, `Delete \u201c${esc(chatTitle(id))}\u201d?`, 'It will be deleted from this Mac.', () => {
      api('DELETE', `/api/chats/${encodeURIComponent(id)}`).then(() => {
        S.convs.delete(id);
        S.drafts.delete(id);
        if (S.currentId === id) S.currentId = null;
        if (S.streaming === id) deps.stopStream();
        deps.loadChats().then(() => { deps.renderChatSidebar(); deps.renderConversation(); deps.restoreDraft(); });
      });
    });
  }

  function revealInFinder(id: string): void {
    api('POST', `/api/chats/${encodeURIComponent(id)}/reveal`).catch(console.warn);
  }

  // ── Folder operations ─────────────────────────────────────────────────────

  function folderName(id: string): string {
    const f = S.folders.find((x) => x.id === id);
    return f?.name ?? 'Folder';
  }

  function renameFolder(id: string): void {
    openSheet(E.sheetBackdrop,
      `<div class="sheet-head">Rename Folder</div><div class="sheet-body"><input class="big" id="rnInput" placeholder="Folder name" value="${esc(folderName(id))}"></div>`,
      [`<button class="btn" data-role="cancel">Cancel</button>`, `<button class="btn prominent" data-role="go">Rename</button>`],
      (root: HTMLElement, close: () => void) => {
        const inp = $('#rnInput', E.sheetBackdrop) as HTMLInputElement;
        const go = () => {
          const t = inp.value.trim();
          if (!t) return;
          api('PATCH', `/api/folders/${encodeURIComponent(id)}`, { name: t }).then(() => {
            const f = S.folders.find((x) => x.id === id);
            if (f) { f.name = t; f.updatedAt = Date.now(); }
            deps.renderChatSidebar();
            close();
          });
        };
        inp.onkeydown = (e: KeyboardEvent) => { if (e.key === 'Enter') go(); };
        ($('[data-role="go"]', root) as HTMLButtonElement).onclick = go;
        setTimeout(() => { inp.focus(); inp.select(); }, UI_TIMING.focusDelayMs);
      });
  }

  function confirmDeleteFolder(id: string): void {
    const name = folderName(id);
    const chatCount = S.chats.filter((c) => c.folderId === id).length;
    const msg = chatCount > 0
      ? `\u201c${esc(name)}\u201d contains <strong>${chatCount}</strong> conversation${chatCount > 1 ? 's' : ''}. They will also be permanently deleted from this Mac.`
      : 'The folder is empty. It will be deleted from this Mac.';

    openConfirm(E.sheetBackdrop, `Delete \u201c${esc(name)}\u201d?`, msg, () => {
      api('DELETE', `/api/folders/${encodeURIComponent(id)}`).then(() => {
        // Clean up local state
        S.folders = S.folders.filter((f) => f.id !== id);
        S.expandedFolders.delete(id);
        // Remove affected chats from local maps
        const affected = S.chats.filter((c) => c.folderId === id);
        for (const c of affected) {
          S.convs.delete(c.id);
          S.drafts.delete(c.id);
          if (S.currentId === c.id) S.currentId = null;
          if (S.streaming === c.id) deps.stopStream();
        }
        S.chats = S.chats.filter((c) => c.folderId !== id);
        deps.renderChatSidebar();
        deps.renderConversation();
        deps.restoreDraft();
      });
    });
  }

  function revealFolder(id: string): void {
    api('POST', `/api/folders/${encodeURIComponent(id)}/reveal`).catch(console.warn);
  }

  return { renameConversation, confirmDelete, revealInFinder, renameFolder, confirmDeleteFolder, revealFolder };
}
