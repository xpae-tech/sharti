// Server screen dispatcher – routes to method cards, API screen, or engine screen

import { S } from '../../core/state.js';
import { downloadCaption } from '../../core/format.js';
import { renderMethodCards } from './method-cards.js';
import { createApiScreen } from './api-screen.js';
import { createEngineScreen, phaseTag } from './engine-screen.js';
import type { Elements } from '../../types';

interface ServerScreenDeps {
  renderServer: () => void;
  renderControlBar: () => void;
  renderComposer: () => void;
  refreshApiCaps: () => void;
  beginApiMutation: () => () => void;
  start: (model: string) => void;
  download: (model: string) => void;
  savePrefs: () => void;
}

export function createServerScreen(E: Elements, deps: ServerScreenDeps) {
  const apiScreen = createApiScreen(E, {
    onRender: () => { deps.renderServer(); deps.renderControlBar(); deps.renderComposer(); },
    onRefreshCaps: deps.refreshApiCaps,
    onBeginMutation: deps.beginApiMutation,
  });

  const engineScreen = createEngineScreen(E, {
    onRender: () => { deps.renderServer(); deps.renderControlBar(); },
    onStart: deps.start,
    onDownload: deps.download,
    onSavePrefs: deps.savePrefs,
  });

  function renderServer(): void {
    const form = E.serverForm;
    const savedScroll = E.serverScroll.scrollTop;
    form.innerHTML = '';
    if (S.serverView === 'method') {
      renderMethodCards(form, {
        onSelectApi: () => { S.serverView = 'api'; renderServer(); deps.renderControlBar(); if (S.externalApi.connected) deps.refreshApiCaps(); },
        onSelectEngine: () => { S.serverView = 'engine'; renderServer(); deps.renderControlBar(); },
      });
    } else if (S.serverView === 'api') {
      apiScreen.render(form);
    } else {
      engineScreen.render(form);
    }
    E.serverScroll.scrollTop = savedScroll;
  }

  /** Lightweight in-place update for engine model states (avoids full rebuild). */
  let lastPhase = S.state?.phase ?? null;

  function updateInPlace(): void {
    const phase = S.state?.phase ?? null;
    if (phase !== lastPhase) {
      // Running state changes the Launch Options lock; rebuild the view.
      lastPhase = phase;
      renderServer();
      return;
    }
    const rows = E.serverForm.querySelectorAll('.model-row');
    const st = S.state;
    rows.forEach((row, i) => {
      if (i >= S.models.length) return;
      const id = S.models[i].id;
      const isRunning = st && st.model === id && (st.phase === 'ready' || st.phase === 'starting' || st.phase === 'stopping');
      const isActive = st && st.model === id && st.phase === 'ready';
      const dot = row.querySelector('.conn-dot');
      if (dot) dot.className = isRunning ? 'conn-dot active' : 'conn-dot';
      const ps = row.querySelector('.model-phase');
      if (ps) ps.textContent = phaseTag(id);
      row.classList.toggle('selected', !!isActive);
    });
  }

  /** In-place update for download progress (avoids full rebuild during transfer). */
  function updateDownloadInPlace(): boolean {
    const fill = E.serverForm.querySelector('[data-progress-fill]') as HTMLElement | null;
    const caption = E.serverForm.querySelector('[data-dl-caption]') as HTMLElement | null;
    if (!fill) return false;
    const dl = S.download;
    if (!dl) return false;
    const pct = dl.progress ? Math.round(dl.progress.fraction * 100) : 0;
    fill.style.width = pct + '%';
    // Toggle indeterminate class
    const track = E.serverForm.querySelector('[data-progress-track]') as HTMLElement | null;
    if (track) track.classList.toggle('indeterminate', !dl.progress);
    if (caption) caption.textContent = downloadCaption(dl);
    return true;
  }

  return { renderServer, updateInPlace, updateDownloadInPlace };
}
