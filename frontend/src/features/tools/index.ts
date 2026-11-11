// Tools Toolbar: renders horizontally-scrollable chips above the composer.
// Includes the "sharti-agent" native tools toggle + MCP server chips.
// Click a chip to activate (coloured) or deactivate (grey).

import { S, currentTuning } from '../../core/state.js';
import { setNativeToolsEnabled } from '../../core/native-tools.js';
import { applyMcpState, snapshotMcpPrefs } from '../../core/mcp.js';
import { NATIVE_SERVER_ID } from '../../types';
import type { Elements, McpState } from '../../types';

interface ToolsDeps {
  savePrefs: () => void;
  renderComposer: () => void;
}

export function createToolsToolbar(_E: Elements, deps: ToolsDeps) {

  /** Refresh the toolbar from current state. Called whenever tools/MCP change. */
  function renderToolsBar(): void {
    const bar = document.getElementById('toolsBar');
    if (!bar) return;

    // Tool Choice off: tools are not sent at all, so the bar is hidden too.
    if (!currentTuning().toolChoice) {
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }

    // Remember the MCP scroller's horizontal position so a re-render
    // (SSE mcp/native-tools, caps refresh, …) never snaps it back to 0.
    const prevScroll = (bar.querySelector('.tools-scroll') as HTMLElement | null)?.scrollLeft ?? 0;

    // Disabled servers are excluded entirely: the bar only ever shows
    // inactive and active tools.
    const servers = S.mcpServers.filter((srv) => !S.disabledMcpServers.has(srv.id));
    const showNativeChip = S.nativeToolsInitialized;
    
    // Hide entirely if nothing to show
    if (servers.length === 0 && !showNativeChip) {
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }

    bar.hidden = false;
    bar.innerHTML = '';

    // ── sharti-agent sticky group (chip + separator) ──────────────────────
    // ── Fixed zone: built-in tool chip (+ separator) ─────────────────────
    // Single standard tool, not expected to grow. Pinned to the left edge
    // of the bar — it never moves, whatever the number of MCP chips.
    if (showNativeChip) {
      const chip = document.createElement('button');
      chip.className = 'tool-chip chip-sticky';
      chip.dataset.nativeToggle = 'true';
      chip.title = 'Sharti Agent — local filesystem & CLI tools';

      if (S.nativeToolsEnabled) chip.classList.add('active');

      const dot = document.createElement('span');
      dot.className = 'chip-mark';
      chip.appendChild(dot);

      const label = document.createElement('span');
      label.className = 'chip-label';
      label.textContent = NATIVE_SERVER_ID;
      chip.appendChild(label);

      chip.onclick = async () => {
        const next = !S.nativeToolsEnabled;
        chip.classList.toggle('active', next);
        deps.renderComposer();
        const confirmed = await setNativeToolsEnabled(next);
        if (!confirmed) {
          chip.classList.toggle('active', S.nativeToolsEnabled);
          deps.renderComposer();
        }
      };

      bar.appendChild(chip);

      // Separator between built-in tools and connectable MCP. Also fixed.
      if (servers.length > 0) {
        const sep = document.createElement('div');
        sep.className = 'tools-separator';
        bar.appendChild(sep);
      }
    }

    // ── MCP server chips ─────────────────────────────────────────────────
    // ── Scrolling zone: connectable MCP chips ────────────────────────────
    // Order: enabled servers first (activation order), then disabled (original order).
    if (servers.length > 0) {
      const scroll = document.createElement('div');
      scroll.className = 'tools-scroll';

      // Build ordered list: enabled (Set preserves insertion order) → disabled (original order)
      const enabledFirst: typeof servers = [];
      const disabledRest: typeof servers = [];
      for (const id of S.enabledMcpServers) {
        const srv = servers.find((s) => s.id === id);
        if (srv) enabledFirst.push(srv);
      }
      for (const srv of servers) {
        if (!S.enabledMcpServers.has(srv.id)) disabledRest.push(srv);
      }
      const ordered = [...enabledFirst, ...disabledRest];

      for (const srv of ordered) {
        const chip = document.createElement('button');
        chip.className = 'tool-chip';
        chip.dataset.serverId = srv.id;
        chip.title = srv.label || srv.id;

        const isActive = S.enabledMcpServers.has(srv.id);
        if (isActive) chip.classList.add('active');

        // Status mark (indicates activation state, not server health)
        const dot = document.createElement('span');
        dot.className = 'chip-mark';
        chip.appendChild(dot);

        const label = document.createElement('span');
        label.className = 'chip-label';
        label.textContent = srv.id;
        chip.appendChild(label);

        chip.onclick = () => {
          if (S.enabledMcpServers.has(srv.id)) {
            S.enabledMcpServers.delete(srv.id);
          } else {
            S.enabledMcpServers.add(srv.id);
          }
          persistEnabledServers();
          deps.renderComposer();
          renderToolsBar();
        };

        scroll.appendChild(chip);
      }

      bar.appendChild(scroll);
      scroll.scrollLeft = prevScroll;
    }
  }

  /** Persist enabled server IDs to backend prefs. */
  function persistEnabledServers(): void {
    snapshotMcpPrefs();
    deps.savePrefs();
  }

  /** Sync local state from server-side MCP state update. */
  function syncFromServer(state: McpState): void {
    applyMcpState(state);
    renderToolsBar();
  }

  return { renderToolsBar, syncFromServer };
}
