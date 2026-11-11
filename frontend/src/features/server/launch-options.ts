// Launch options form: every `splash serve` option the app can set, grouped
// like the reference (main, memory, cache, network, API, requests).

import { afterSwitchSlide, el, esc } from '../../core/dom.js';
import { activeDot, divider } from '../../ui/card.js';
import { S } from '../../core/state.js';
import { DEFAULT_ENGINE_PORT } from '../../../../shared/app-defaults.js';
import type { ServeOptions } from '../../types';

type OptionSection = 'main' | 'memory' | 'cache' | 'network' | 'api' | 'requests';

interface OptionDef {
  key: string;
  label: string;
  section: OptionSection;
  type: 'text' | 'choice' | 'toggle' | 'secret';
  ph?: string;
  help?: string;
  choices?: Array<[string, string]> | (() => Array<[string, string]>);
  /** Choice accepts a typed value (shown with a datalist). */
  custom?: boolean;
  /** Comma/space separated values, emitted as repeated flags. */
  list?: boolean;
  /** The switch means the flag is absent (e.g. --no-webui). */
  invert?: boolean;
  validate?: (raw: string) => string | null;
  applies?: (o: ServeOptions) => boolean;
  warning?: (o: ServeOptions) => string | null;
}

const advSections: Exclude<OptionSection, 'main'>[] = ['memory', 'cache', 'network', 'api', 'requests'];
/** Sections the user has expanded; all start collapsed. */
const openSections = new Set<OptionSection>();
const SECTION_TITLES: Record<OptionSection, string> = {
  main: 'Launch Options',
  memory: 'Memory',
  cache: 'SSD Cache',
  network: 'Network and Access',
  api: 'API',
  requests: 'Requests',
};

// ── Value helpers ───────────────────────────────────────────────────────────

const opts = (): ServeOptions => S.prefs.options || {};
const textOf = (key: string): string => {
  const v = opts()[key];
  return v == null ? '' : String(v);
};
const isOn = (key: string): boolean => {
  const v = opts()[key];
  return v === true || v === 'true' || v === 1 || v === '1';
};
const cacheOff = (): boolean => textOf('maxCacheDisk') === '0';

const nonEmpty = (raw: string): string | null => (raw.trim() ? raw.trim() : null);
const whole = (min: number, max = Number.MAX_SAFE_INTEGER) => (raw: string): string | null => {
  const n = Number(raw.trim());
  return Number.isInteger(n) && n >= min && n <= max ? String(n) : null;
};
const sizeValue = (allowZero: boolean) => (raw: string): string | null => {
  const value = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (allowZero && value === '0') return value;
  return /^\d+(\.\d+)?(?:[KMG](?:B|IB)?)?$/.test(value) && Number.parseFloat(value) > 0 ? value : null;
};
const size = sizeValue(false);
const sizeOrZero = sizeValue(true);
const duration = (raw: string): string | null => {
  const value = raw.trim().toLowerCase();
  return /^\d+(\.\d+)?[smh]?$/.test(value) && Number.parseFloat(value) > 0 ? value : null;
};
const contextTokens = (raw: string): string | null => {
  const value = raw.trim().toUpperCase().replace(/\s+/g, '');
  const m = value.match(/^(\d{1,9})([KM]?)$/);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === 'K' ? 1024 : m[2] === 'M' ? 1_000_000 : 1);
  return n >= 1 && n <= 1_010_000 ? value : null;
};
const portValue = whole(1, 65_535);
const pixels = whole(65_536, 4_194_304);
const share = (raw: string): string | null => {
  const n = Number(raw.trim());
  return Number.isFinite(n) && n >= 0 ? String(n) : null;
};
const pathValue = (raw: string): string | null => {
  const value = raw.trim();
  return value.startsWith('/') || value.startsWith('~') ? value : null;
};
const listValue = (raw: string): string | null => {
  const items = raw.split(/[,\s]+/).filter(Boolean);
  return items.length ? items.join(', ') : null;
};

function memoryChoices(): Array<[string, string]> {
  return [8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384]
    .filter((n) => n < S.ramGb)
    .map((n) => [`${n}G`, `${n} GB`]);
}

// ── Option catalog ──────────────────────────────────────────────────────────

export const OPTION_DEFS: OptionDef[] = [
  // Launch Options
  {
    key: 'maxContext', section: 'main', label: 'Context Length', type: 'choice', ph: 'Auto',
    help: 'How much of a conversation the model keeps in mind. Auto fits it to this Mac\u2019s memory.',
    choices: [['16K', '16K tokens'], ['32K', '32K tokens'], ['64K', '64K tokens'], ['128K', '128K tokens'], ['256K', '256K tokens']],
    custom: true, validate: contextTokens,
  },
  {
    key: 'maxMemory', section: 'main', label: 'Memory Limit', type: 'choice', ph: 'Auto',
    help: 'The most memory the model may use, leaving room for other apps. Auto gives it what this Mac can.',
    choices: memoryChoices, custom: true, validate: size,
  },
  {
    key: 'idleRelease', section: 'main', label: 'Free Memory When Idle', type: 'choice',
    help: 'An idle model frees its memory and loads again with the next message.',
    choices: [['', 'Auto (10 minutes)'], ['30m', 'After 30 minutes'], ['1h', 'After 1 hour'], ['off', 'Never']],
    custom: true, validate: duration,
  },
  {
    key: 'languageOnly', section: 'main', label: 'Text Only', type: 'toggle',
    help: 'Leaves the model\u2019s vision out: it loads less and refuses images and PDFs.',
  },

  // Memory
  {
    key: 'kvFormat', section: 'memory', label: 'KV Cache', type: 'choice',
    help: 'How the model keeps what it has read in memory. 16-bit takes twice the memory.',
    choices: [['', 'Auto (8-bit)'], ['int8', '8-bit (INT8)'], ['bf16', '16-bit (BF16)']],
  },
  {
    key: 'stateFormat', section: 'memory', label: 'Recurrent State', type: 'choice',
    help: 'How a hybrid model such as Qwen3.6 keeps its state. 16-bit takes half the memory.',
    choices: [['', 'Auto (32-bit)'], ['fp32', '32-bit (FP32)'], ['bf16', '16-bit (BF16)']],
  },
  {
    key: 'expertMemory', section: 'memory', label: 'Expert Memory', type: 'choice', ph: 'Auto',
    help: 'Memory for a MoE model\u2019s experts; the rest are read from the SSD as tokens need them. Off keeps every expert in memory.',
    choices: [['', 'Auto'], ['off', 'Off']], custom: true, validate: size,
  },
  {
    key: 'pleMemory', section: 'memory', label: 'PLE Table Memory', type: 'choice', ph: 'Auto',
    help: 'Memory for the n-gram table of Qwen3.8-Flash-Next; the rest streams from the SSD. Off loads the whole table.',
    choices: [['', 'Auto'], ['off', 'Off']], custom: true, validate: size,
  },
  {
    key: 'sparseKvMemory', section: 'memory', label: 'Sparse KV Memory', type: 'choice', ph: 'Auto',
    help: 'Memory for the KV blocks Qwen3.8-Flash-Next reads back from the SSD.',
    choices: [['', 'Auto']], custom: true, validate: size,
  },

  // SSD Cache
  {
    key: 'maxCacheDisk', section: 'cache', label: 'Size', type: 'choice', ph: 'Auto',
    help: 'Room on the SSD for earlier prompts. Auto follows the free space.',
    choices: [['', 'Auto'], ['0', 'Off'], ['16G', '16 GB'], ['32G', '32 GB'], ['64G', '64 GB']],
    custom: true, validate: sizeOrZero,
  },
  {
    key: 'maxCacheDiskWrites', section: 'cache', label: 'Writes a Day', type: 'choice', ph: 'No Limit',
    help: 'The most the SSD cache writes in a day, to spare the SSD.',
    choices: [['', 'No Limit'], ['100G', '100 GB'], ['200G', '200 GB'], ['500G', '500 GB']],
    custom: true, validate: sizeOrZero, applies: () => !cacheOff(),
  },
  {
    key: 'persistentCache', section: 'cache', label: 'Keep After Stopping', type: 'toggle',
    help: 'The next start of the model goes on from the prompts it kept.',
    applies: () => !cacheOff(),
  },
  {
    key: 'cacheDir', section: 'cache', label: 'Folder', type: 'text', ph: 'Default',
    help: 'Where the persistent SSD cache lives.',
    validate: pathValue, applies: () => !cacheOff() && isOn('persistentCache'),
  },

  // Network and Access
  {
    key: 'port', section: 'network', label: 'Port', type: 'text', ph: String(DEFAULT_ENGINE_PORT),
    help: 'Where the model answers, for this app, coding agents and other apps.',
    validate: portValue,
  },
  {
    key: 'host', section: 'network', label: 'Listen On', type: 'choice',
    help: 'This Mac only, or every network it is on, for other devices to reach the model.',
    choices: [['', 'This Mac Only (127.0.0.1)'], ['0.0.0.0', 'All Networks']],
    warning: (o) => o.host && !o.apiKey
      ? 'Any device on these networks can use the model. Set an API key to require one.' : null,
  },
  {
    key: 'allowedHost', section: 'network', label: 'Host Names', type: 'text', ph: 'None', list: true,
    help: 'Other names clients reach this Mac by, such as mymac.local. Comma separated.',
    validate: listValue,
  },
  {
    key: 'allowedOrigin', section: 'network', label: 'Web Origins', type: 'text', ph: 'None', list: true,
    help: 'Origins whose pages may call the API from a browser, such as tauri://localhost; * for any.',
    validate: listValue,
    warning: (o) => String(o.allowedOrigin ?? '').split(/[,\s]+/).includes('*') && !o.apiKey
      ? 'Any website open in a browser can use the model. Set an API key to require one.' : null,
  },
  {
    key: 'apiKey', section: 'network', label: 'API Key', type: 'secret', ph: 'None',
    help: 'A key every request but the chat page\u2019s must carry. Sent to the server in its environment.',
    validate: nonEmpty,
  },
  {
    key: 'noWebui', section: 'network', label: 'Browser Chat Page', type: 'toggle', invert: true,
    help: 'The chat page at the model\u2019s address, for a browser.',
  },
  {
    key: 'offline', section: 'network', label: 'Offline Mode', type: 'toggle',
    help: 'Start installed files without contacting the Hugging Face Hub.',
  },

  // API
  {
    key: 'defaultReasoningEffort', section: 'api', label: 'Thinking', type: 'choice',
    help: 'How much the model thinks for apps whose requests don\u2019t say. The chat asks for its own.',
    choices: [['', 'Model\u2019s Default'], ['none', 'No Thinking'], ['minimal', 'Minimal'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra High'], ['max', 'Max']],
  },
  {
    key: 'thinkingTokenBudget', section: 'api', label: 'Thinking Tokens', type: 'text', ph: 'No limit',
    help: 'The most a request that sets none thinks before its thinking closes.',
    validate: whole(0),
  },
  {
    key: 'thinkingEndText', section: 'api', label: 'Thinking End Text', type: 'text', ph: '</think>',
    help: 'What closes thinking where its budget runs out.',
    validate: nonEmpty,
  },
  {
    key: 'servedModelName', section: 'api', label: 'Other Model Names', type: 'text', ph: 'None', list: true,
    help: 'More names requests may give the model, such as gpt-4o. Comma separated.',
    validate: listValue,
  },
  {
    key: 'announceServedName', section: 'api', label: 'Answer as the First Other Name', type: 'toggle',
    help: 'Replies and the model list give the first other name rather than the model\u2019s.',
    applies: () => Boolean(textOf('servedModelName')),
  },

  // Requests
  {
    key: 'requestTimeout', section: 'requests', label: 'Request Timeout', type: 'choice', ph: 'None',
    help: 'How long a request may wait and run before it ends with an error.',
    choices: [['', 'None'], ['5m', '5 minutes'], ['30m', '30 minutes'], ['1h', '1 hour']],
    custom: true, validate: duration,
  },
  {
    key: 'queueSize', section: 'requests', label: 'Requests at Once', type: 'text', ph: '32 (Default)',
    help: 'Requests the model takes at once, running or waiting; more are turned away.',
    validate: whole(1),
  },
  {
    key: 'maxRequestSize', section: 'requests', label: 'Request Size', type: 'text', ph: '128M (Default)',
    help: 'The largest request body, images and PDFs included.',
    validate: size,
  },
  {
    key: 'maxImagePixels', section: 'requests', label: 'Image Pixels', type: 'text', ph: '4194304 (Default)',
    help: 'The most pixels an image is resized to, 65,536 to 4,194,304.',
    validate: pixels,
  },
  {
    key: 'decodeShare', section: 'requests', label: 'Answering While Reading', type: 'text', ph: '0.5 (Default)',
    help: 'Answer time owed per second spent reading a new prompt; 0 takes turns step by step.',
    validate: share,
  },
  {
    key: 'verifyRows', section: 'requests', label: 'Repeatable Answers', type: 'choice',
    help: 'A MoE model\u2019s greedy and seeded answers repeat exactly, at some cost in speed.',
    choices: [['', 'Auto'], ['all', 'On (all rows)']],
  },
  {
    key: 'disableAne', section: 'requests', label: 'Disable Neural Engine', type: 'toggle',
    help: 'Prefill on the GPU alone; the Neural Engine can speed up long prompts.',
  },
  {
    key: 'allowIdleSleep', section: 'requests', label: 'Allow Mac Sleep While Answering', type: 'toggle',
    help: 'The Mac may sleep in the middle of an answer.',
  },
];

// ── Rendering ───────────────────────────────────────────────────────────────

function modelIsRunning(): boolean {
  const phase = S.state && S.state.phase;
  return phase === 'ready' || phase === 'starting' || phase === 'stopping';
}

interface LaunchOptionsCallbacks {
  onSavePrefs: () => void;
  onRender: () => void;
}

export function renderLaunchOptions(cb: LaunchOptionsCallbacks): HTMLElement {
  const { onSavePrefs, onRender } = cb;
  const locked = modelIsRunning();
  const card = el('div', 'card');
  const hd = el('div', 'card-head');
  const titleWrap = el('div');
  titleWrap.style.display = 'flex';
  titleWrap.style.alignItems = 'center';
  titleWrap.appendChild(el('div', 'section-title', 'Launch Options'));
  if (locked) titleWrap.appendChild(el('span', 'opt-badge', 'Read only while running'));
  hd.appendChild(titleWrap);
  const hasCustomOpts = Object.keys(S.prefs.options || {}).length > 0;
  const rr = el('button', 'link-btn', 'Restore Defaults') as HTMLButtonElement;
  rr.onclick = () => { S.prefs.options = {}; onSavePrefs(); onRender(); };
  if (!hasCustomOpts || locked) rr.disabled = true;
  hd.appendChild(rr);
  card.appendChild(hd);

  const main = OPTION_DEFS.filter((d) => d.section === 'main');
  main.forEach((d, i) => {
    card.appendChild(optionRow(d, onSavePrefs, onRender, locked));
    if (i < main.length - 1) card.appendChild(divider());
  });

  const disc = el('div', 'disclosure' + (S.advanced ? ' open' : ''));
  disc.innerHTML = '<span class="chev"></span><span>Advanced</span>';
  card.appendChild(disc);

  // Always build the body so the disclosure can animate like a tool block;
  // the CSS grid row goes from 0fr (closed) to 1fr (open).
  const adv = el('div', 'advanced-body' + (S.advanced ? ' show' : ''));
  adv.inert = !S.advanced;
  const advFold = el('div', 'advanced-fold');

  for (const section of advSections) {
    const defs = OPTION_DEFS.filter((d) => d.section === section);
    if (!defs.length) continue;

    // Each sub-band is a collapsible section, collapsed on first open.
    const expanded = openSections.has(section);
    const block = el('div', 'launch-section' + (expanded ? '' : ' collapsed'));
    const band = el('button', 'sub-band launch-band') as HTMLButtonElement;
    band.type = 'button';
    band.innerHTML = `<span class="chev band-chev"></span><span>${esc(SECTION_TITLES[section])}</span>`;
    band.onclick = () => {
      const isOpen = !block.classList.contains('collapsed');
      block.classList.toggle('collapsed', isOpen);
      body.inert = isOpen;
      if (isOpen) openSections.delete(section);
      else openSections.add(section);
    };
    block.appendChild(band);

    const body = el('div', 'launch-band-body');
    body.inert = !expanded;
    const fold = el('div', 'launch-band-fold');
    defs.forEach((d, index) => {
      fold.appendChild(optionRow(d, onSavePrefs, onRender, locked));
      if (index < defs.length - 1) fold.appendChild(divider());
    });
    body.appendChild(fold);
    block.appendChild(body);
    advFold.appendChild(block);
  }

  adv.appendChild(advFold);
  card.appendChild(adv);

  disc.onclick = () => {
    S.advanced = !S.advanced;
    disc.classList.toggle('open', S.advanced);
    adv.classList.toggle('show', S.advanced);
    adv.inert = !S.advanced;
  };

  return card;
}

function optionRow(def: OptionDef, onSavePrefs: () => void, onRender: () => void, locked: boolean): HTMLElement {
  const o = opts();
  const applicable = !def.applies || def.applies(o);
  const editable = applicable && !locked;
  const row = el('div', 'opt-row' + (applicable ? '' : ' disabled') + (locked ? ' locked' : ''));
  const left = el('div');
  const active = Object.prototype.hasOwnProperty.call(o, def.key);
  left.innerHTML = `<div class="opt-label">${esc(def.label)}${activeDot(active)}</div>`;
  if (def.help) left.innerHTML += `<div class="opt-help">${esc(def.help)}</div>`;
  const warning = applicable ? def.warning?.(o) : null;
  if (warning) {
    left.innerHTML += `<div class="opt-warning"><span class="tri">\u25b2</span><span>${esc(warning)}</span></div>`;
  }
  row.appendChild(left);

  const ctrl = el('div');
  if (def.type === 'secret') ctrl.classList.add('opt-secret-control');
  let renderQueued = false;
  const commit = (sw?: HTMLElement): void => {
    onSavePrefs();
    if (renderQueued) return;
    renderQueued = true;
    const finish = (): void => {
      renderQueued = false;
      onRender();
    };
    if (sw) {
      // Rebuilding the form before the knob settles would skip the animation.
      afterSwitchSlide(sw, finish);
      return;
    }
    // Let native select/datalist popups finish closing before the form is
    // replaced; otherwise the popup can be left orphaned on screen.
    requestAnimationFrame(finish);
  };

  if (def.type === 'toggle') {
    const shown = def.invert ? !isOn(def.key) : isOn(def.key);
    const sw = el('div', 'switch' + (shown ? ' on' : ''));
    if (editable) {
      sw.onclick = () => {
        const next = !sw.classList.contains('on');
        sw.classList.toggle('on', next);
        if (def.invert) {
          if (next) delete S.prefs.options[def.key];
          else S.prefs.options[def.key] = true;
        } else {
          if (next) S.prefs.options[def.key] = true;
          else delete S.prefs.options[def.key];
        }
        commit(sw);
      };
    }
    ctrl.appendChild(sw);
  } else if (def.type === 'choice' && !def.custom) {
    const choices = resolveChoices(def);
    const sel = el('select', 'field') as HTMLSelectElement;
    sel.style.textAlign = 'left';
    sel.disabled = !editable;
    choices.forEach(([value, label]) => {
      const option = el('option', '', esc(label)) as HTMLOptionElement;
      option.value = value;
      sel.appendChild(option);
    });
    const current = textOf(def.key);
    sel.value = choices.some(([v]) => v === current) ? current : '';
    sel.onchange = () => {
      if (sel.value) S.prefs.options[def.key] = sel.value;
      else delete S.prefs.options[def.key];
      sel.blur();
      commit();
    };
    ctrl.appendChild(sel);
  } else {
    const inp = el('input', 'field') as HTMLInputElement;
    inp.placeholder = def.ph || '';
    inp.value = textOf(def.key);
    inp.spellcheck = false;
    inp.disabled = !editable;
    if (def.type === 'secret') {
      inp.type = 'password';
      inp.autocomplete = 'off';
    }
    const choices = def.choices ? resolveChoices(def) : [];
    if (choices.length) {
      const datalist = document.createElement('datalist');
      datalist.id = `dl-${def.key}`;
      choices.forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.label = label;
        datalist.appendChild(option);
      });
      ctrl.appendChild(datalist);
      inp.setAttribute('list', datalist.id);
    }
    const apply = (): void => {
      const raw = inp.value.trim();
      if (!raw) {
        if (textOf(def.key) === '') return;
        if (def.type === 'secret') {
          // Preserve an explicit clear signal; the backend keeps a stored
          // secret when the field is omitted from the prefs payload.
          S.prefs.options[def.key] = '';
          S.splashApiKeySet = false;
          commit();
          return;
        }
        delete S.prefs.options[def.key];
        commit();
        return;
      }
      const parsed = def.validate ? def.validate(raw) : raw;
      if (parsed == null) {
        inp.classList.add('invalid');
        return;
      }
      inp.classList.remove('invalid');
      if (parsed === textOf(def.key)) {
        inp.value = parsed;
        return;
      }
      S.prefs.options[def.key] = parsed;
      if (def.type === 'secret') S.splashApiKeySet = true;
      commit();
    };
    inp.onblur = apply;
    inp.onkeydown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      else if (e.key === 'Escape') inp.blur();
    };
    ctrl.appendChild(inp);
    if (def.type === 'secret' && S.splashApiKeySet) {
      const clear = el('button', 'link-btn', 'Clear stored key') as HTMLButtonElement;
      clear.type = 'button';
      clear.onclick = () => {
        S.prefs.options[def.key] = '';
        S.splashApiKeySet = false;
        inp.value = '';
        commit();
      };
      ctrl.appendChild(clear);
    }
  }

  row.appendChild(ctrl);
  return row;
}

function resolveChoices(def: OptionDef): Array<[string, string]> {
  if (!def.choices) return [];
  return typeof def.choices === 'function' ? def.choices() : def.choices;
}
