// System page rows: theme selection and LLM traffic logging. These are
// independent of the tuning form and live in their own component module.

import { el } from '../../core/dom.js';
import { activeDot } from '../../ui/card.js';
import { S } from '../../core/state.js';
import { normalizeTheme, setTheme } from '../../core/theme.js';
import type { RowCallbacks } from './rows.js';

export function loggingRow(cb: RowCallbacks): HTMLElement {
  const row = el('div', 'opt-row');
  const left = el('div');
  const label = el('div', 'opt-label');
  const paintLabel = (): void => {
    label.innerHTML = 'Log LLM Requests' + activeDot(S.prefs.llmLogging === true);
  };
  paintLabel();
  left.appendChild(label);
  left.appendChild(el('div', 'opt-help',
    'Write every outgoing request and its full response to '
    + 'log_chat-id.json in the chat\'s files folder. Logs can take up a lot of disk space.'));
  row.appendChild(left);

  const ctrl = el('div');
  let value = S.prefs.llmLogging === true;
  const sw = el('div', 'switch' + (value ? ' on' : ''));
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', String(value));
  sw.tabIndex = 0;
  const toggle = (): void => {
    value = !value;
    S.prefs.llmLogging = value;
    sw.classList.toggle('on', value);
    sw.setAttribute('aria-checked', String(value));
    paintLabel();
    cb.onSave();
    cb.onDirty();
  };
  sw.onclick = toggle;
  sw.onkeydown = (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      toggle();
    }
  };
  ctrl.appendChild(sw);
  row.appendChild(ctrl);
  return row;
}

export function themeRow(cb: RowCallbacks): HTMLElement {
  const row = el('div', 'opt-row');
  const left = el('div');
  left.innerHTML = '<div class="opt-label">Theme</div><div class="opt-help">Choose the interface color theme.</div>';
  row.appendChild(left);

  const current = normalizeTheme(S.prefs.theme);
  const ctrl = el('div', 'theme-switch');
  ctrl.setAttribute('role', 'radiogroup');
  ctrl.setAttribute('aria-label', 'Interface theme');

  const options: Array<[typeof current, string]> = [['dark', 'Dark'], ['light', 'Light']];
  for (const [value, label] of options) {
    const btn = el('button', 'theme-option' + (current === value ? ' active' : ''), label) as HTMLButtonElement;
    btn.type = 'button';
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(current === value));
    btn.onclick = () => {
      if (normalizeTheme(S.prefs.theme) === value) return;
      setTheme(value);
      // Update this radiogroup in place: a re-render would replace the
      // switch and cut the sliding-thumb transition short.
      for (const option of ctrl.querySelectorAll<HTMLButtonElement>('.theme-option')) {
        const active = option === btn;
        option.classList.toggle('active', active);
        option.setAttribute('aria-checked', String(active));
      }
      cb.onSave();
    };
    ctrl.appendChild(btn);
  }

  row.appendChild(ctrl);
  return row;
}
