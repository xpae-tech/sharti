// Model Tuning tab: one global tuning profile applied to both the Splash
// engine and every external OpenAI-compatible provider.

import { el } from '../../core/dom.js';
import { cardHead } from '../../ui/card.js';
import { S } from '../../core/state.js';
import { effectiveTuning } from '../../../../shared/tuning.js';
import type { ModelTuning } from '../../types.js';
import {
  PLUGIN_RESET_KEYS,
  PRIORITY_OPTIONS,
  REASONING_FIELDS,
  REQUEST_FIELDS,
  SAMPLING_FIELDS,
  SYSTEM_RESET_KEYS,
  TOOL_TOGGLES,
  TUNING_RESET_KEYS,
  choiceRow,
  numberRow,
  promptRow,
  sectionCard,
  toggleRow,
} from './rows.js';
import type { RowCallbacks, TuningCallbacks } from './rows.js';
import { createMcpConfigEditor, mcpServersCard, nativePluginCard, toolCardsCard } from './plugins.js';
import { loggingRow, themeRow } from './system.js';
import { tunedActive } from './state.js';

export function createTuningScreen(cb: TuningCallbacks) {
  let resetBtn: HTMLButtonElement | null = null;
  let resetKeys: (keyof ModelTuning)[] = [];
  let formDirty = false;
  /** Page-specific non-tuning reset state (e.g. the Logging toggle). */
  let extraHasChanges: (() => boolean) | null = null;
  let extraReset: (() => void) | null = null;
  const mcpEditor = createMcpConfigEditor();

  function syncResetState(): void {
    if (!resetBtn) return;
    const tuning = S.prefs.tuning ?? {};
    const hasValues = resetKeys.some((key) => tuning[key] !== undefined && tuning[key] !== '');
    const hasExtraValues = extraHasChanges ? extraHasChanges() : false;
    resetBtn.disabled = !formDirty && !hasValues && !hasExtraValues;
  }

  function markDirty(): void {
    formDirty = true;
    syncResetState();
  }

  function renderPage(
    form: HTMLElement,
    title: string,
    description: string,
    keys: (keyof ModelTuning)[],
    build: (tuning: ReturnType<typeof effectiveTuning>, cb: RowCallbacks) => void,
    extras?: { hasChanges: () => boolean; reset: () => void },
  ): void {
    const scroller = form.parentElement;
    const savedScroll = scroller?.scrollTop ?? 0;
    form.innerHTML = '';
    S.prefs.tuning = S.prefs.tuning || {};
    formDirty = false;
    extraHasChanges = extras?.hasChanges ?? null;
    extraReset = extras?.reset ?? null;
    const tuning = effectiveTuning(S.prefs.tuning, S.prefs.options);
    const rowCb: RowCallbacks = {
      ...cb,
      onInput: markDirty,
      onDirty: () => {
        formDirty = false;
        syncResetState();
      },
    };

    resetKeys = keys;
    form.appendChild(pageHeader(title));
    form.appendChild(el('p', 'srv-desc', description));
    syncResetState();
    build(tuning, rowCb);
    if (scroller) scroller.scrollTop = savedScroll;
  }

  function render(form: HTMLElement): void {
    renderPage(
      form,
      'Model Tuning',
      'Control sampling, reasoning depth, and the system prompt shared by all connections.',
      TUNING_RESET_KEYS,
      (tuning, rowCb) => {
        form.appendChild(sectionCard('Custom Sampling', [
          toggleRow({
            key: 'customSampling',
            label: 'Enable custom sampling',
            help: 'Controls sampling, reasoning, and the system prompt. When off, only messages and the fields required to connect are sent.',
          }, tuning, rowCb),
        ]));

        const prompt = el('div', 'card');
        prompt.appendChild(cardHead('System Prompt', tunedActive('systemPrompt')));
        prompt.appendChild(promptRow(rowCb, tuning.customSampling));
        form.appendChild(prompt);

        form.appendChild(sectionCard('Sampling', [
          ...SAMPLING_FIELDS.map((def) => numberRow(def, tuning.customSampling, tuning, rowCb)),
        ]));

        form.appendChild(sectionCard('Reasoning', [
          numberRow(REASONING_FIELDS[0], tuning.customSampling, tuning, rowCb),
        ]));
      },
    );
  }

  function renderPlugins(form: HTMLElement): void {
    renderPage(
      form,
      'Plugins & MCP',
      'Control how tools are exposed to the model, manage MCP servers, and edit mcp.json.',
      PLUGIN_RESET_KEYS,
      (tuning, rowCb) => {
        form.appendChild(toolCardsCard('Plugins', [nativePluginCard(rowCb)]));
        form.appendChild(mcpServersCard(rowCb));
        form.appendChild(mcpEditor.render(rowCb));
        form.appendChild(sectionCard('Tools', [
          ...TOOL_TOGGLES.map((def) => toggleRow(def, tuning, rowCb)),
        ]));
      },
    );
  }

  function renderSystem(form: HTMLElement): void {
    renderPage(
      form,
      'System',
      'Interface and request-level behavior shared by every connection.',
      SYSTEM_RESET_KEYS,
      (tuning, rowCb) => {
        form.appendChild(sectionCard('Interface', [themeRow(rowCb)]));
        const priorityRow = choiceRow(
          'Priority',
          'Request priority in the engine queue.',
          'Only Splash',
          'priority',
          PRIORITY_OPTIONS,
          true,
          tuning,
          rowCb,
        );
        form.appendChild(sectionCard('Request', [
          priorityRow,
          ...REQUEST_FIELDS.map((def) => numberRow(def, true, tuning, rowCb)),
        ]));
        form.appendChild(sectionCard('Logging', [loggingRow(rowCb)]));
      },
      {
        hasChanges: () => S.prefs.llmLogging === true,
        reset: () => { S.prefs.llmLogging = false; },
      },
    );
  }

  function pageHeader(title: string): HTMLElement {
    const header = el('div', 'tuning-page-head');
    header.appendChild(el('div', 'srv-title', title));
    const reset = el('button', 'link-btn', 'Restore Defaults') as HTMLButtonElement;
    resetBtn = reset;
    reset.onclick = () => {
      S.prefs.tuning = S.prefs.tuning || {};
      for (const key of resetKeys) delete S.prefs.tuning[key];
      if (extraReset) extraReset();
      formDirty = false;
      cb.onSave();
      cb.onRender();
      cb.onRequestRender();
    };
    header.appendChild(reset);
    return header;
  }

  function collapseMcpConfig(): void {
    mcpEditor.collapse();
  }

  return { render, renderPlugins, renderSystem, collapseMcpConfig };
}
