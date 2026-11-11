// Plugins & MCP page components: native plugin card, MCP server cards and the
// mcp.json editor. The editor keeps its draft/notice/open state across
// settings re-renders inside createMcpConfigEditor().

import { el, esc } from '../../core/dom.js';
import { cardHead } from '../../ui/card.js';
import { api } from '../../core/api.js';
import { S } from '../../core/state.js';
import { applyMcpState, mcpServerStatus, snapshotMcpPrefs } from '../../core/mcp.js';
import { setNativeToolsEnabled } from '../../core/native-tools.js';
import type { McpServerStatus } from '../../core/mcp.js';
import { NATIVE_SERVER_ID } from '../../types.js';
import type { McpServerInfo } from '../../types';
import type { RowCallbacks } from './rows.js';

export function statusLabel(status: McpServerStatus): string {
  if (status === 'disabled') return 'Disabled';
  if (status === 'active') return 'Active';
  return 'Inactive';
}

export function toolCardsCard(title: string, cards: HTMLElement[]): HTMLElement {
  const card = el('div', 'card');
  card.appendChild(cardHead(title));
  const body = el('div', 'tool-card-body');
  const grid = el('div', 'tool-cards-grid');
  cards.forEach((item) => grid.appendChild(item));
  body.appendChild(grid);
  card.appendChild(body);
  return card;
}

export function nativePluginCard(rowCb: RowCallbacks): HTMLElement {
  // sharti-agent is the ecosystem plugin: it can be active or inactive but
  // never disabled, so a click only toggles activation.
  const status: McpServerStatus = S.nativeToolsEnabled ? 'active' : 'inactive';
  return toolCard({
    name: NATIVE_SERVER_ID,
    description: 'Built-in local filesystem and CLI tools. Always available as part of the Sharti ecosystem.',
    status,
    onClick: () => {
      const enabled = !S.nativeToolsEnabled;
      // The toggle endpoint is the sole writer for this preference; the
      // helper updates state optimistically and reverts on failure.
      rowCb.onRequestRender();
      rowCb.onRender();
      void setNativeToolsEnabled(enabled).then(() => {
        rowCb.onRequestRender();
        rowCb.onRender();
      });
    },
  });
}

export function mcpServersCard(rowCb: RowCallbacks): HTMLElement {
  const card = el('div', 'card');
  card.appendChild(cardHead('MCP servers'));
  const body = el('div', 'tool-card-body');

  if (S.mcpServers.length === 0) {
    body.appendChild(el('div', 'opt-help', 'No MCP servers configured. Add them in mcp.json below.'));
  } else {
    const grid = el('div', 'tool-cards-grid');
    for (const srv of S.mcpServers) {
      grid.appendChild(mcpServerCard(srv, rowCb));
    }
    body.appendChild(grid);
  }

  card.appendChild(body);
  return card;
}

function mcpServerCard(srv: McpServerInfo, rowCb: RowCallbacks): HTMLElement {
  const status = mcpServerStatus(srv.id);
  const tools = S.mcpTools.filter((tool) => tool.serverId === srv.id);
  const description = srv.error
    || tools[0]?.description
    || (tools.length > 0 ? `${tools.length} available tool${tools.length === 1 ? '' : 's'}.` : 'MCP server.');

  const commit = (): void => {
    if (S.disabledMcpServers.has(srv.id)) S.enabledMcpServers.delete(srv.id);
    snapshotMcpPrefs();
    rowCb.onSave();
    rowCb.onRender();
    rowCb.onRequestRender();
  };

  return toolCard({
    name: srv.label || srv.id,
    detail: srv.id,
    description,
    status,
    onClick: () => {
      // Card click only switches activity: inactive ↔ active. A disabled
      // card is brought back to inactive.
      if (status === 'disabled') {
        S.disabledMcpServers.delete(srv.id);
      } else if (status === 'active') {
        S.enabledMcpServers.delete(srv.id);
      } else {
        S.enabledMcpServers.add(srv.id);
      }
      commit();
    },
    onToggleDisabled: () => {
      // The status-block button is the only way to enter/leave disabled.
      if (status === 'disabled') {
        S.disabledMcpServers.delete(srv.id);
      } else {
        S.enabledMcpServers.delete(srv.id);
        S.disabledMcpServers.add(srv.id);
      }
      commit();
    },
  });
}

function toolCard(opts: {
  name: string;
  detail?: string;
  description: string;
  status: McpServerStatus;
  onClick?: () => void;
  onToggleDisabled?: () => void;
}): HTMLElement {
  const card = el('div', `tool-card ${opts.status}`) as HTMLDivElement;
  card.dataset.status = opts.status;
  card.title = opts.description;
  card.tabIndex = 0;
  card.setAttribute('role', 'button');

  const activate = (): void => {
    if (opts.onClick) opts.onClick();
  };
  card.onclick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('.tool-card-disable')) return;
    activate();
  };
  card.onkeydown = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if ((e.target as HTMLElement).closest('.tool-card-disable')) return;
    e.preventDefault();
    activate();
  };

  const top = el('div', 'tool-card-top');
  const dot = el('span', 'conn-dot');
  if (opts.status === 'active') dot.classList.add('active');
  if (opts.status === 'disabled') dot.classList.add('disabled');
  top.appendChild(dot);
  top.appendChild(el('span', 'tool-card-name', esc(opts.name)));
  card.appendChild(top);

  if (opts.detail) card.appendChild(el('div', 'tool-card-detail', esc(opts.detail)));
  card.appendChild(el('div', 'tool-card-desc', esc(opts.description)));

  const statusRow = el('div', 'tool-card-status');
  statusRow.appendChild(el('span', 'tool-card-status-label', statusLabel(opts.status)));
  if (opts.onToggleDisabled) {
    const disabled = opts.status === 'disabled';
    const btn = el('button', 'tool-card-disable' + (disabled ? ' is-disabled' : '')) as HTMLButtonElement;
    btn.type = 'button';
    btn.title = disabled ? 'Enable tool' : 'Disable tool';
    btn.setAttribute('aria-pressed', String(disabled));
    btn.setAttribute('aria-label', btn.title);
    const icon = el('span', 'tool-card-disable-icon' + (disabled ? ' is-disabled' : ''));
    icon.appendChild(el('span', 'glyph wrench'));
    btn.appendChild(icon);
    btn.onclick = (e: MouseEvent) => {
      e.stopPropagation();
      opts.onToggleDisabled?.();
    };
    statusRow.appendChild(btn);
  }
  card.appendChild(statusRow);
  return card;
}

export interface McpConfigEditor {
  render(rowCb: RowCallbacks): HTMLElement;
  collapse(): void;
}

export function createMcpConfigEditor(): McpConfigEditor {
  /** Unsaved mcp.json editor text, preserved across settings re-renders. */
  let draft: string | null = null;
  let noticeState: { text: string; error: boolean } | null = null;
  /** The block starts collapsed but keeps its state while re-rendering. */
  let open = false;

  function render(rowCb: RowCallbacks): HTMLElement {
    const MIN_EDITOR_HEIGHT = 160;
    const MAX_EDITOR_HEIGHT = 420;

    const card = el('div', 'card mcp-config-card' + (open ? ' open' : ''));
    const toggle = el('button', 'mcp-config-toggle' + (open ? ' open' : '')) as HTMLButtonElement;
    toggle.type = 'button';
    toggle.setAttribute('aria-expanded', String(open));
    toggle.appendChild(el('span', 'chev'));
    toggle.appendChild(el('span', 'section-title', 'mcp.json'));
    const pathLabel = el('span', 'mcp-config-path', 'Loading…');
    toggle.appendChild(pathLabel);
    card.appendChild(toggle);

    const fold = el('div', 'mcp-config-fold');
    const foldInner = el('div', 'mcp-config-fold-inner');
    const body = el('div', 'mcp-config-body');
    body.appendChild(el('div', 'opt-help', 'Edit the MCP configuration directly. Saving reloads the available MCP servers.'));
    foldInner.appendChild(body);
    fold.appendChild(foldInner);
    card.appendChild(fold);

    const editorWrap = el('div', 'mcp-config-editor-wrap');
    const area = el('textarea', 'mcp-config-editor') as HTMLTextAreaElement;
    area.spellcheck = false;
    area.placeholder = '{\n  "mcpServers": {}\n}';
    if (draft !== null) area.value = draft;
    editorWrap.appendChild(area);
    body.appendChild(editorWrap);

    const fitEditor = (): void => {
      if (!area.isConnected) return;
      // Resizing the textarea changes the form height; keep the surrounding
      // settings scroller exactly where the user left it.
      const scroller = card.closest('.form-scroll') as HTMLElement | null;
      const scrollTop = scroller?.scrollTop ?? 0;
      area.style.height = 'auto';
      const next = Math.max(MIN_EDITOR_HEIGHT, Math.min(MAX_EDITOR_HEIGHT, area.scrollHeight));
      area.style.height = `${next}px`;
      if (scroller) scroller.scrollTop = scrollTop;
    };

    const actions = el('div', 'mcp-config-actions');
    const notice = el('span', 'mcp-config-state');
    const cancel = el('button', 'btn sm', 'Cancel') as HTMLButtonElement;
    cancel.type = 'button';
    const save = el('button', 'btn prominent sm', 'Save') as HTMLButtonElement;
    save.type = 'button';
    actions.appendChild(notice);
    actions.appendChild(cancel);
    actions.appendChild(save);
    body.appendChild(actions);

    let baselineText = '';
    let configLoaded = false;

    const setNotice = (text: string, error = false): void => {
      notice.textContent = text;
      notice.classList.toggle('error', error);
    };

    const syncDirty = (): void => {
      const dirty = configLoaded && area.value !== baselineText;
      cancel.disabled = !dirty;
      save.disabled = !dirty;
    };

    syncDirty();

    const syncOpen = (): void => {
      card.classList.toggle('open', open);
      toggle.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', String(open));
      if (open) requestAnimationFrame(fitEditor);
    };

    toggle.onclick = () => {
      open = !open;
      syncOpen();
    };

    if (noticeState) setNotice(noticeState.text, noticeState.error);

    const loadConfig = async (resetDraft: boolean): Promise<boolean> => {
      try {
        const res = await api('GET', '/api/mcp/config');
        pathLabel.textContent = res.path || 'mcp.json';
        baselineText = typeof res.content === 'string' ? res.content : '';
        configLoaded = true;
        if (resetDraft) draft = null;
        if (area.isConnected && draft === null) {
          area.value = baselineText;
        }
        fitEditor();
        syncDirty();
        if (noticeState?.error) {
          noticeState = null;
          setNotice('');
        }
        return true;
      } catch (e) {
        pathLabel.textContent = 'mcp.json';
        noticeState = { text: (e as Error).message, error: true };
        setNotice(noticeState.text, true);
        return false;
      }
    };

    area.oninput = () => {
      draft = area.value;
      noticeState = null;
      setNotice('');
      fitEditor();
      syncDirty();
    };

    cancel.onclick = async () => {
      cancel.disabled = true;
      save.disabled = true;
      setNotice('Discarding changes…');
      const loaded = await loadConfig(true);
      if (loaded) {
        noticeState = { text: 'Changes discarded', error: false };
        setNotice(noticeState.text);
      }
      syncDirty();
    };

    save.onclick = async () => {
      save.disabled = true;
      cancel.disabled = true;
      setNotice('Saving…');
      try {
        // The backend writes mcp.json and immediately reloads MCP servers,
        // so a successful save is also the Reload step.
        const res = await api('PUT', '/api/mcp/config', { content: area.value });
        draft = null;
        if (res?.state) applyMcpState(res.state);
        snapshotMcpPrefs();
        noticeState = { text: 'Saved', error: false };
        rowCb.onSave();
        rowCb.onRequestRender();
        rowCb.onRender();
      } catch (e) {
        noticeState = { text: (e as Error).message, error: true };
        setNotice(noticeState.text, true);
        syncDirty();
      }
    };

    void loadConfig(false);
    requestAnimationFrame(fitEditor);

    return card;
  }

  function collapse(): void {
    open = false;
  }

  return { render, collapse };
}
