// Settings modal open/close/toggle

import { S } from '../core/state.js';
import type { Elements } from '../types';

export function createSettingsModal(
  E: Elements,
  { onAfterOpen, onAfterClose }: { onAfterOpen?: () => void; onAfterClose?: () => void }
) {
  function open(): void {
    if (S.settingsOpen) return;
    S.settingsTab = 'connection';
    S.serverView = 'method';
    S.settingsOpen = true;
    E.settingsModal.classList.add('open');
    if (onAfterOpen) onAfterOpen();
  }

  function close(): void {
    if (!S.settingsOpen) return;
    // Commit any in-progress field (e.g. the system prompt textarea).
    const active = document.activeElement as HTMLElement | null;
    if (active && E.settingsModal.contains(active)) active.blur();
    S.settingsOpen = false;
    E.settingsModal.classList.remove('open');
    if (onAfterClose) onAfterClose();
  }

  function toggle(): void {
    if (S.settingsOpen) close(); else open();
  }

  E.settingsGear.onclick = toggle;
  E.settingsClose.onclick = close;
  E.smBackdrop.onclick = close;

  return { open, close, toggle };
}
