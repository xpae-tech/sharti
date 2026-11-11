// Chat sidebar: conversation list with folders, search, open/new, drag & drop

import { el, esc } from '../../core/dom.js';
import { S, contextLimit, stashCurrentDraft, restoreDraft } from '../../core/state.js';
import { contextBadgeInfo } from '../../core/context.js';
import { api } from '../../core/api.js';
import { openPopup } from '../../ui/popup.js';
import type { Elements, ChatSummary, Folder } from '../../types';

interface SidebarDeps {
  renderConversation: () => void;
  applyDraftToDom: () => void;
  autosize: () => void;
  renderAttachments: () => void;
  renderComposer: () => void;
  renameConversation: (id: string) => void;
  confirmDelete: (id: string) => void;
  revealInFinder: (id: string) => void;
  renameFolder: (id: string) => void;
  confirmDeleteFolder: (id: string) => void;
  revealFolder: (id: string) => void;
}

export function createChatSidebar(E: Elements, deps: SidebarDeps) {
  // ── Load data ─────────────────────────────────────────────────────────────

  async function loadData(): Promise<void> {
    try {
      const [chatsRes, foldersRes]: any[] = await Promise.all([
        api('GET', '/api/chats'),
        api('GET', '/api/folders'),
      ]);
      S.chats = chatsRes.chats.map((c: any) => ({
        id: c.id,
        name: c.name ?? c.title ?? '',
        updatedAt: c.updatedAt ?? c.updated ?? 0,
        tokenCount: typeof c.tokenCount === 'number' ? c.tokenCount : 0,
        folderId: c.folderId ?? null,
      }));
      S.folders = foldersRes.folders ?? [];
    } catch {
      S.chats = [];
      S.folders = [];
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function renderChatSidebar(): void {
    // Guarantee newest-first ordering regardless of how state mutated.
    S.chats.sort((a, b) => b.updatedAt - a.updatedAt);

    const q = S.searchQuery.trim().toLowerCase();
    const list = E.convList;
    list.innerHTML = '';

    const filteredChats = S.chats.filter((c) => !q || c.name.toLowerCase().includes(q));

    // Search results are a flat list: folder grouping is intentionally hidden
    // so matches from different folders are shown together in one zone.
    if (q) {
      if (!filteredChats.length) {
        list.appendChild(emptyRow('No matches.'));
        return;
      }
      list.appendChild(chatZone(filteredChats, '__general__'));
      return;
    }

    const generalChats = filteredChats.filter((c) => !c.folderId);
    const foldersToShow = [...S.folders].sort((a, b) => b.updatedAt - a.updatedAt);

    if (!filteredChats.length && !foldersToShow.length) {
      list.appendChild(emptyRow('No conversations yet.'));
      return;
    }

    // ── Folders (sorted by updatedAt, newest first) ──
    foldersToShow.forEach((f) => {
      list.appendChild(renderFolderBlock(f, filteredChats));
    });

    // ── General zone (ungrouped chats) ──
    list.appendChild(chatZone(generalChats, '__general__', generalChats.length === 0));
  }

  function emptyRow(text: string): HTMLElement {
    const empty = el('div', 'req-empty', text);
    empty.style.padding = '12px 8px';
    return empty;
  }

  function chatZone(chats: ChatSummary[], dropTarget: string, placeholder = false): HTMLElement {
    const zone = el('div', 'zone-general');
    zone.dataset.dropTarget = dropTarget;
    chats.forEach((c) => zone.appendChild(renderChatRow(c)));
    if (placeholder) zone.appendChild(el('div', 'zone-placeholder'));
    return zone;
  }

  function contextBadgeHtml(tokens: number): string {
    const info = contextBadgeInfo(tokens, contextLimit());
    if (!info) return '';
    return `<span class="conv-ctx${info.critical ? ' critical' : ''}" title="${esc(info.tooltip)}">${esc(info.label)}</span>`;
  }

  /** Refresh only the active row's badge when the context limit changes. */
  function refreshContextBadge(): void {
    const chat = S.chats.find((c) => c.id === S.currentId);
    const row = E.convList.querySelector('.conv-row.open') as HTMLElement | null;
    const slot = row?.querySelector('.conv-actions');
    if (!chat || !slot) return;
    slot.querySelector('.conv-ctx')?.remove();
    const html = contextBadgeHtml(chat.tokenCount);
    if (html) slot.insertAdjacentHTML('afterbegin', html);
  }

  function renderChatRow(c: ChatSummary): HTMLButtonElement {
    const b = el('button', 'conv-row' + (c.id === S.currentId ? ' open' : '')) as HTMLButtonElement;
    b.draggable = true;
    b.dataset.chatId = c.id;
    const badge = c.id === S.currentId ? contextBadgeHtml(c.tokenCount) : '';
    b.innerHTML = `<span class="conv-title">${esc(c.name || 'New Chat')}</span><span class="conv-actions">${badge}<button class="dots-btn">\u00b7\u00b7\u00b7</button></span>`;
    b.onclick = () => openConversation(c.id);

    const cdots = b.querySelector('.dots-btn') as HTMLButtonElement;
    cdots.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      openPopup(cdots, [
        { id: 'ren', title: 'Rename' },
        { id: 'find', title: 'Show in Finder' },
        { id: 'del', title: 'Delete' },
      ], (id: string) => {
        if (id === 'ren') deps.renameConversation(c.id);
        if (id === 'find') deps.revealInFinder(c.id);
        if (id === 'del') deps.confirmDelete(c.id);
      }, true);
    };

    // D&D handlers on chat row
    b.addEventListener('dragstart', (e: DragEvent) => {
      e.dataTransfer!.setData('text/plain', c.id);
      e.dataTransfer!.effectAllowed = 'move';
      requestAnimationFrame(() => b.classList.add('dragging'));
    });
    b.addEventListener('dragend', () => {
      b.classList.remove('dragging');
      clearDropHighlights();
    });

    return b;
  }

  function renderFolderBlock(f: Folder, allChats: ChatSummary[]): HTMLDivElement {
    const block = el('div', 'folder-block') as HTMLDivElement;
    block.dataset.dropTarget = f.id;
    block.dataset.folderId = f.id;

    const expanded = S.expandedFolders.has(f.id);

    // Header
    const header = el('div', 'folder-header' + (expanded ? ' open' : ''));
    const arrow = el('span', 'folder-chevron glyph chevron');
    const name = el('span', 'folder-name', esc(f.name));
    const dots = el('button', 'dots-btn', '\u00b7\u00b7\u00b7');

    header.append(arrow, name, dots);
    header.onclick = () => toggleFolder(f.id);
    dots.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      openPopup(dots, [
        { id: 'ren', title: 'Rename' },
        { id: 'find', title: 'Show in Finder' },
        { id: 'del', title: 'Delete' },
      ], (id: string) => {
        if (id === 'ren') deps.renameFolder(f.id);
        if (id === 'find') deps.revealFolder(f.id);
        if (id === 'del') deps.confirmDeleteFolder(f.id);
      }, true);
    };

    block.appendChild(header);

    // Children (only when expanded)
    if (expanded) {
      const childContainer = el('div', 'folder-chats');
      const folderChats = allChats.filter((c) => c.folderId === f.id);
      if (folderChats.length === 0) {
        const hint = el('div', 'folder-empty', 'Empty');
        childContainer.appendChild(hint);
      } else {
        folderChats.forEach((c) => childContainer.appendChild(renderChatRow(c)));
      }
      block.appendChild(childContainer);
    }

    return block;
  }

  // ── Folder toggle ─────────────────────────────────────────────────────────

  function toggleFolder(id: string): void {
    const expanding = !S.expandedFolders.has(id);
    if (expanding) S.expandedFolders.add(id);
    else S.expandedFolders.delete(id);

    // Incremental update: keep existing DOM nodes alive so CSS transitions fire.
    const block = E.convList.querySelector(`[data-folder-id="${CSS.escape(id)}"]`) as HTMLElement | null;
    if (!block) {
      renderChatSidebar();
      return;
    }

    const header = block.querySelector(':scope > .folder-header') as HTMLElement;
    header.classList.toggle('open', expanding);

    const childContainer = block.querySelector(':scope > .folder-chats') as HTMLElement | null;
    if (expanding) {
      if (!childContainer) {
        S.chats.sort((a, b) => b.updatedAt - a.updatedAt);
        const cc = el('div', 'folder-chats');
        const folderChats = S.chats.filter((c: ChatSummary) => c.folderId === id);
        if (folderChats.length === 0) {
          cc.appendChild(el('div', 'folder-empty', 'Empty'));
        } else {
          folderChats.forEach((c) => cc.appendChild(renderChatRow(c)));
        }
        block.appendChild(cc);
      }
    } else if (childContainer) {
      childContainer.remove();
    }
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  async function openConversation(id: string): Promise<void> {
    if (id === S.currentId) { deps.renderConversation(); return; }
    stashCurrentDraft();
    S.currentId = id;
    if (!S.convs.has(id)) {
      try {
        const c = await api('GET', `/api/chats/${encodeURIComponent(id)}`);
        S.convs.set(id, c);
      } catch {
        S.convs.set(id, { id, name: '', createdAt: Date.now(), updatedAt: Date.now(), tokenCount: 0, userLastMessagedAt: null, assistantLastMessagedAt: null, messages: [], files: [], folderId: null });
      }
    }
    restoreDraft(deps.applyDraftToDom);
    renderChatSidebar();
    deps.renderConversation();
  }

  function newChat(): void {
    stashCurrentDraft();
    S.currentId = null;
    S.draft = { text: '', attachments: [] };
    E.composerInput.value = '';
    deps.autosize();
    deps.renderAttachments();
    renderChatSidebar();
    deps.renderConversation();
    deps.renderComposer();
    E.composerInput.focus();
  }

  // ── Drag & Drop ───────────────────────────────────────────────────────────

  function clearDropHighlights(): void {
    E.convList.querySelectorAll('.drop-highlight').forEach((elm) => elm.classList.remove('drop-highlight'));
  }

  function setupDropZones(): void {
    const list = E.convList;

    list.addEventListener('dragover', (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'move';
      // Find nearest drop zone ancestor
      const zone = (e.target as HTMLElement).closest('[data-drop-target]') as HTMLElement | null;
      clearDropHighlights();
      if (zone) zone.classList.add('drop-highlight');
    });

    list.addEventListener('dragleave', (e: DragEvent) => {
      const related = (e.relatedTarget as HTMLElement)?.closest?.('[data-drop-target]');
      if (!related) clearDropHighlights();
    });

    list.addEventListener('drop', (e: DragEvent) => {
      e.preventDefault();
      clearDropHighlights();
      const chatId = e.dataTransfer!.getData('text/plain');
      if (!chatId) return;

      const zone = (e.target as HTMLElement).closest('[data-drop-target]') as HTMLElement | null;
      if (!zone) return;

      const targetFolderId = zone.dataset.dropTarget === '__general__' ? null : zone.dataset.dropTarget;

      // Determine current folder of the dragged chat
      const chat = S.chats.find((c) => c.id === chatId);
      if (!chat) return;
      const currentFolderId = chat.folderId ?? null;

      // No-op if same location
      if (currentFolderId === targetFolderId) return;

      // Perform move
      api('PATCH', `/api/chats/${encodeURIComponent(chatId)}/folder`, { folderId: targetFolderId }).then(() => {
        // Update local state
        chat.folderId = targetFolderId;
        chat.updatedAt = Date.now();
        // Auto-expand target folder if it was collapsed
        if (targetFolderId) S.expandedFolders.add(targetFolderId);
        renderChatSidebar();
      }).catch(console.warn);
    });
  }

  // Setup drop zones once (event delegation on the list container)
  setupDropZones();

  return { loadData, renderChatSidebar, refreshContextBadge, newChat };
}
