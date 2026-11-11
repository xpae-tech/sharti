// Tuning form primitives: field definitions and the row builders shared by
// all three settings pages. Keeping them together avoids three near-identical
// implementations of number/toggle/choice rows.

import { afterSwitchSlide, el, esc } from '../../core/dom.js';
import { activeDot, cardHead, divider } from '../../ui/card.js';
import { S } from '../../core/state.js';
import { TUNING_DEFAULTS, TUNING_LIMITS, effectiveTuning } from '../../../../shared/tuning.js';
import type { ModelTuning } from '../../types';
import { parseNumberInput, setTunedValue, tunedActive, tunedValue } from './state.js';

export type NumberKey =
  | 'temperature'
  | 'topK'
  | 'topP'
  | 'minP'
  | 'presencePenalty'
  | 'frequencyPenalty'
  | 'repetitionPenalty'
  | 'seed'
  | 'maxTokens'
  | 'thinkingTokenBudget'
  | 'timeout'
  | 'maxRetries';

export type ToggleKey = 'customSampling' | 'toolChoice' | 'toolApproval' | 'parallelToolCalls';

export interface NumberDef {
  key: NumberKey;
  label: string;
  help: string;
  min: number;
  max: number;
  int?: boolean;
  step?: number;
}

export interface ToggleDef {
  key: ToggleKey;
  label: string;
  help: string;
  /** Optional scope badge shown next to the label (e.g. "Only Splash"). */
  badge?: string;
  /** Whether changing it must rebuild the page (some toggles gate other rows). */
  rerender?: boolean;
}

export interface TuningCallbacks {
  onSave: () => void;
  onRender: () => void;
  onRequestRender: () => void;
}

export interface RowCallbacks extends TuningCallbacks {
  /** Marks the form dirty while an edit is still uncommitted. */
  onInput: () => void;
  /** Recomputes the Restore Defaults state after a commit. */
  onDirty: () => void;
}

export const SAMPLING_FIELDS: NumberDef[] = [
  { key: 'temperature', label: 'Temperature', help: 'Sampling temperature (0 to 2).', min: 0, max: 2, step: 0.01 },
  { key: 'topK', label: 'Top K', help: 'Number of highest-probability tokens (-1 to 100).', min: -1, max: 100, int: true },
  { key: 'topP', label: 'Top P', help: 'Nucleus sampling threshold (0 to 1).', min: 0, max: 1, step: 0.01 },
  { key: 'minP', label: 'Min P', help: 'Minimum probability threshold (0 to 1).', min: 0, max: 1, step: 0.01 },
  { key: 'presencePenalty', label: 'Presence Penalty', help: 'Penalizes tokens that already appear (-2 to 2).', min: -2, max: 2, step: 0.01 },
  { key: 'frequencyPenalty', label: 'Frequency Penalty', help: 'Penalizes tokens by frequency (-2 to 2).', min: -2, max: 2, step: 0.01 },
  { key: 'repetitionPenalty', label: 'Repetition Penalty', help: 'Penalizes repeated tokens (0.1 to 2).', min: 0.1, max: 2, step: 0.01 },
  { key: 'seed', label: 'Seed', help: 'Random seed for reproducibility (-1 = random).', min: -1, max: 999999999, int: true },
  { key: 'maxTokens', label: 'Max Tokens', help: 'Maximum number of tokens to generate.', min: 0, max: 128000, int: true },
];

export const REASONING_FIELDS: NumberDef[] = [
  {
    key: 'thinkingTokenBudget',
    label: 'Thinking Token Budget',
    help: 'Max thinking tokens (-1 = no cap). Empty inherits the Splash Thinking Tokens option.',
    min: TUNING_LIMITS.thinkingTokenBudget.min,
    max: TUNING_LIMITS.thinkingTokenBudget.max,
    int: true,
  },
];

export const TOOL_TOGGLES: ToggleDef[] = [
  {
    key: 'toolChoice',
    label: 'Tool Choice',
    help: 'Off sends no tools to the model and hides the tools bar.',
    rerender: false,
  },
  {
    key: 'toolApproval',
    label: 'Tool Approval',
    help: 'Pause before every tool call so you can accept, reject, or correct its arguments.',
    rerender: false,
  },
  {
    key: 'parallelToolCalls',
    label: 'Parallel Tool Calls',
    help: 'Allow the model to call several tools in one turn.',
    badge: 'Only Splash',
    rerender: false,
  },
];

export const REQUEST_FIELDS: NumberDef[] = [
  {
    key: 'timeout',
    label: 'Request Timeout (s)',
    help: 'Max seconds a request may run (0 = no timeout). Empty inherits Splash Request Timeout. Applied locally; not sent to the provider.',
    min: TUNING_LIMITS.timeout.min,
    max: TUNING_LIMITS.timeout.max,
    int: true,
  },
  {
    key: 'maxRetries',
    label: 'Max Retries',
    help: 'Retry attempts on transient upstream failures (0 to 5). Global, not per connection.',
    min: TUNING_LIMITS.maxRetries.min,
    max: TUNING_LIMITS.maxRetries.max,
    int: true,
  },
];

export const PRIORITY_OPTIONS: Array<[ModelTuning['priority'], string]> = [
  ['foreground', 'Foreground'],
  ['normal', 'Normal'],
  ['background', 'Background'],
];

export const TUNING_RESET_KEYS: (keyof ModelTuning)[] = [
  'customSampling',
  'systemPrompt',
  'temperature',
  'topK',
  'topP',
  'minP',
  'presencePenalty',
  'frequencyPenalty',
  'repetitionPenalty',
  'seed',
  'maxTokens',
  'thinkingTokenBudget',
];

export const PLUGIN_RESET_KEYS: (keyof ModelTuning)[] = ['toolChoice', 'toolApproval', 'parallelToolCalls'];

export const SYSTEM_RESET_KEYS: (keyof ModelTuning)[] = ['priority', 'timeout', 'maxRetries'];

export function sectionCard(title: string, rows: HTMLElement[]): HTMLElement {
  const card = el('div', 'card');
  card.appendChild(cardHead(title));
  rows.forEach((row, index) => {
    card.appendChild(row);
    if (index < rows.length - 1) card.appendChild(divider());
  });
  return card;
}

export function promptRow(cb: RowCallbacks, enabled: boolean): HTMLElement {
  const row = el('div', 'tuning-prompt-row' + (enabled ? '' : ' disabled'));
  const area = el('textarea', 'tuning-prompt') as HTMLTextAreaElement;
  area.placeholder = 'Optional system instruction prepended to every request (empty by default).';
  area.value = S.prefs.tuning.systemPrompt ?? '';
  area.spellcheck = true;
  area.disabled = !enabled;
  const commit = (): void => {
    const value = area.value.trim();
    setTunedValue('systemPrompt', value);
    cb.onSave();
    cb.onDirty();
    cb.onRender();
    cb.onRequestRender();
  };
  area.onblur = commit;
  area.oninput = () => cb.onInput();
  const wrap = el('div', 'tuning-prompt-wrap');
  wrap.appendChild(area);
  row.appendChild(wrap);
  if (!enabled) row.appendChild(el('div', 'opt-help', 'Enable Custom Sampling to use a system prompt.'));
  return row;
}

export function numberRow(
  def: NumberDef,
  enabled: boolean,
  tuning: ReturnType<typeof effectiveTuning>,
  cb: RowCallbacks,
): HTMLElement {
  const row = el('div', 'opt-row' + (enabled ? '' : ' disabled'));
  const left = el('div');
  left.innerHTML = `<div class="opt-label">${esc(def.label)}${activeDot(tunedActive(def.key))}</div><div class="opt-help">${esc(def.help)}</div>`;
  row.appendChild(left);

  const ctrl = el('div');
  const inp = el('input', 'field') as HTMLInputElement;
  inp.type = 'number';
  inp.min = String(def.min);
  inp.max = String(def.max);
  if (def.int) inp.step = '1';
  else if (def.step != null) inp.step = String(def.step);
  inp.placeholder = String(tuning[def.key]);
  inp.value = tunedValue(def.key) == null ? '' : String(tunedValue(def.key));
  inp.spellcheck = false;
  inp.disabled = !enabled;
  inp.oninput = () => cb.onInput();

  const apply = (): void => {
    const parsed = parseNumberInput(inp.value, def);
    if (parsed.kind === 'empty') {
      setTunedValue(def.key, undefined);
      inp.classList.remove('invalid');
      inp.placeholder = String(tuning[def.key]);
      cb.onSave();
      cb.onRequestRender();
      cb.onDirty();
      cb.onRender();
      return;
    }
    if (parsed.kind === 'invalid') {
      inp.classList.add('invalid');
      return;
    }
    inp.classList.remove('invalid');
    setTunedValue(def.key, parsed.value as never, true);
    inp.placeholder = String(effectiveTuning(S.prefs.tuning, S.prefs.options)[def.key]);
    cb.onSave();
    cb.onRequestRender();
    cb.onDirty();
    cb.onRender();
  };

  inp.onblur = apply;
  inp.onkeydown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
  };
  ctrl.appendChild(inp);
  row.appendChild(ctrl);
  return row;
}

export function toggleRow(
  def: ToggleDef,
  tuning: ReturnType<typeof effectiveTuning>,
  cb: RowCallbacks,
): HTMLElement {
  const row = el('div', 'opt-row');
  const left = el('div');
  const badgeHtml = def.badge ? `<span class="opt-badge">${esc(def.badge)}</span>` : '';
  left.innerHTML = `<div class="opt-label">${esc(def.label)}${activeDot(tunedActive(def.key))}${badgeHtml}</div><div class="opt-help">${esc(def.help)}</div>`;
  row.appendChild(left);

  const ctrl = el('div');
  const value = Boolean(tuning[def.key]);
  const sw = el('div', 'switch' + (value ? ' on' : ''));
  const label = left.querySelector('.opt-label') as HTMLElement | null;
  let renderQueued = false;
  sw.onclick = () => {
    const next = !sw.classList.contains('on');
    sw.classList.toggle('on', next);
    setTunedValue(def.key, next);
    cb.onSave();
    cb.onDirty();
    cb.onRequestRender();
    if (renderQueued) return;
    renderQueued = true;
    afterSwitchSlide(sw, () => {
      renderQueued = false;
      // A toggle that does not gate other rows only needs its active dot
      // refreshed; rebuilding the page would disturb unrelated editors below.
      if (def.rerender === false) {
        syncToggleDot(label, def.key);
        return;
      }
      cb.onRender();
    });
  };
  ctrl.appendChild(sw);
  row.appendChild(ctrl);
  return row;
}

/** Refresh the override dot without rebuilding the surrounding page. */
function syncToggleDot(label: HTMLElement | null, key: ToggleKey): void {
  if (!label) return;
  label.querySelector('.opt-active-dot')?.remove();
  if (!tunedActive(key)) return;
  const dot = el('span', 'conn-dot active opt-active-dot');
  label.insertBefore(dot, label.querySelector('.opt-badge'));
}

export function choiceRow(
  label: string,
  help: string,
  badge: string,
  key: 'priority',
  options: Array<[ModelTuning['priority'], string]>,
  enabled: boolean,
  tuning: ReturnType<typeof effectiveTuning>,
  cb: RowCallbacks,
): HTMLElement {
  const row = el('div', 'opt-row' + (enabled ? '' : ' disabled'));
  const left = el('div');
  const badgeHtml = badge ? `<span class="opt-badge">${esc(badge)}</span>` : '';
  left.innerHTML = `<div class="opt-label">${esc(label)}${activeDot(tunedActive(key))}${badgeHtml}</div><div class="opt-help">${esc(help)}</div>`;
  row.appendChild(left);

  const ctrl = el('div');
  const sel = el('select', 'field') as HTMLSelectElement;
  sel.style.textAlign = 'left';
  sel.disabled = !enabled;
  options.forEach(([value, text]) => {
    const option = el('option', '', esc(text)) as HTMLOptionElement;
    option.value = value ?? '';
    sel.appendChild(option);
  });
  sel.value = tuning[key] || TUNING_DEFAULTS[key];
  sel.onchange = () => {
    setTunedValue(key, sel.value as ModelTuning['priority']);
    cb.onSave();
    cb.onRequestRender();
    cb.onDirty();
    cb.onRender();
  };
  ctrl.appendChild(sel);
  row.appendChild(ctrl);
  return row;
}
