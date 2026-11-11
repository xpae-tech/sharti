import type { ReasoningInfo } from './types.js';

/** Ascending weight used to order effort-menu entries (higher = deeper). */
export function effortWeight(effort: string): number {
  switch (effort.trim().toLowerCase()) {
    case 'none':
    case 'off':
    case 'disabled':
    case 'no_thinking':
      return 0;
    case 'minimal':
      return 0.5;
    case '':
    case 'default':
    case 'on':
    case 'auto':
    case 'low':
      return 1;
    case 'medium':
      return 2;
    case 'high':
      return 3;
    case 'xhigh':
    case 'extra-high':
    case 'very-high':
      return 4;
    case 'max':
    case 'maximum':
      return 5;
    default:
      // Keep unknown provider-specific levels between low and medium.
      return 1.5;
  }
}

/** Deduplicated effort list ordered for the menu: deepest at the top, off at the bottom. */
export function sortEffortsForMenu(efforts: string[]): string[] {
  return [...new Set(efforts)].sort((a, b) => effortWeight(b) - effortWeight(a));
}

/** Keys under which providers advertise their reasoning levels. */
const EFFORT_KEYS = [
  'efforts',
  'effort',
  'levels',
  'allowed_options',
  'allowedOptions',
  'reasoning_efforts',
  'supported_reasoning_efforts',
  'reasoning_levels',
  'supported_efforts',
];

/** Keys under which providers expose the default reasoning level. */
const DEFAULT_KEYS = [
  'default',
  'defaultEffort',
  'default_effort',
  'default_reasoning_effort',
  'defaultReasoningEffort',
];

/** Parameter names that imply a model can reason. */
const REASONING_PARAMETERS = [
  'reasoning',
  'reasoning_content',
  'reasoning_effort',
  'reasoning_details',
  'reasoning_summary',
  'include_reasoning',
  'thinking',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asStringList(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) return value.flatMap(asStringList);
  if (isRecord(value)) {
    // Some providers express levels as a map: { low: true, high: true }.
    return Object.entries(value)
      .filter(([, enabled]) => enabled === true || enabled === 'true')
      .map(([key]) => key);
  }
  return [];
}

function normalizeEfforts(value: unknown): string[] {
  const seen = new Set<string>();
  const efforts: string[] = [];
  for (const item of asStringList(value)) {
    const effort = item.trim().toLowerCase();
    if (!effort || seen.has(effort)) continue;
    seen.add(effort);
    efforts.push(effort);
  }
  return efforts;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/** Reads an explicit reasoning descriptor from the shapes providers use. */
function readDescriptor(raw: unknown): ReasoningInfo | null {
  if (raw == null) return null;
  if (typeof raw === 'boolean') return { thinks: raw, efforts: [], default: null };
  if (typeof raw === 'string') {
    const value = raw.trim().toLowerCase();
    if (!value || value === 'none' || value === 'false' || value === 'off' || value === 'disabled') {
      return { thinks: false, efforts: [], default: null };
    }
    return { thinks: true, efforts: [], default: null };
  }
  if (!isRecord(raw)) return null;

  const efforts: string[] = [];
  for (const key of EFFORT_KEYS) efforts.push(...normalizeEfforts(raw[key]));

  let def = pickString(raw, DEFAULT_KEYS);
  // Some providers hand back a single `reasoning_effort` instead of a list.
  if (!def && typeof raw.reasoning_effort === 'string') def = raw.reasoning_effort.trim() || null;

  const supported = raw.thinks ?? raw.supported ?? raw.enabled ?? raw.available;
  const thinks = typeof supported === 'boolean'
    ? supported
    : efforts.length > 0 || def !== null;

  return { thinks, efforts: [...new Set(efforts)], default: def };
}

function mergeDescriptor(target: ReasoningInfo | null, next: ReasoningInfo | null): ReasoningInfo | null {
  if (!next) return target;
  if (!target) return next;
  return {
    thinks: target.thinks || next.thinks,
    efforts: [...new Set([...target.efforts, ...next.efforts])],
    default: target.default ?? next.default,
  };
}

/**
 * Normalizes the several reasoning shapes different OpenAI-compatible servers
 * return (boolean, `{thinks,efforts,default}`, `{supported,defaultEffort}`).
 */
export function parseReasoning(raw: unknown): ReasoningInfo | null {
  // Historically a falsy value means "no reasoning capability".
  if (raw === false) return null;
  return readDescriptor(raw);
}

/**
 * Extracts reasoning capabilities from a model object returned by
 * `/v1/models`, covering the metadata exposed by Splash / LM Studio,
 * OpenRouter (`supported_parameters`), vLLM, Ollama and other compatible
 * providers. Model-name heuristics are used only when the provider supplies
 * no capability metadata at all.
 */
export function parseReasoningFromModel(model: unknown): ReasoningInfo | null {
  if (!isRecord(model)) return null;

  let info: ReasoningInfo | null = null;

  info = mergeDescriptor(info, readDescriptor(model.reasoning));
  info = mergeDescriptor(info, readDescriptor(model.thinking));
  info = mergeDescriptor(info, readDescriptor(model.supports_reasoning));
  info = mergeDescriptor(info, readDescriptor(model.reasoning_supported));

  const capabilities = isRecord(model.capabilities) ? model.capabilities : null;
  const features = isRecord(model.features) ? model.features : null;
  if (features) {
    info = mergeDescriptor(info, readDescriptor(features.reasoning));
    info = mergeDescriptor(info, readDescriptor(features.thinking));
    info = mergeDescriptor(info, readDescriptor(features.supports_reasoning));
  }
  if (capabilities) {
    info = mergeDescriptor(info, readDescriptor(capabilities.reasoning));
    info = mergeDescriptor(info, readDescriptor(capabilities.thinking));
    info = mergeDescriptor(info, readDescriptor(capabilities.reasoning_effort));
    info = mergeDescriptor(info, readDescriptor(capabilities.supports_reasoning));
  }

  // OpenRouter and several gateways advertise capability names in a flat list.
  const parameters = asStringList(
    model.supported_parameters
      ?? model.supportedParameters
      ?? capabilities?.supported_parameters
      ?? model.parameters,
  ).map((p) => p.toLowerCase());

  const parameterSet = new Set(parameters);
  const advertisesReasoning = REASONING_PARAMETERS.some((p) => parameterSet.has(p));
  if (advertisesReasoning) {
    // This only tells us that reasoning exists; the allowed levels must come
    // from explicit provider metadata (efforts/allowed_options).
    info = mergeDescriptor(info, { thinks: true, efforts: [], default: null });
  }

  // Explicit arrays/defaults are sometimes placed at the top level or under
  // the capabilities object.
  for (const source of [model, capabilities]) {
    if (!source) continue;
    const efforts: string[] = [];
    for (const key of EFFORT_KEYS) efforts.push(...normalizeEfforts(source[key]));
    const def = pickString(source, DEFAULT_KEYS)
      ?? (typeof source.reasoning_effort === 'string' ? source.reasoning_effort.trim() || null : null);
    if (efforts.length || def) {
      info = mergeDescriptor(info, {
        thinks: true,
        efforts,
        default: def,
      });
    }
  }

  // Nested default parameters (OpenRouter and some gateways).
  const defaultParameters = isRecord(model.default_parameters) ? model.default_parameters : null;
  if (defaultParameters) {
    const nestedEffort = typeof defaultParameters.reasoning_effort === 'string'
      ? defaultParameters.reasoning_effort.trim()
      : '';
    if (nestedEffort) {
      info = mergeDescriptor(info, { thinks: true, efforts: [], default: nestedEffort });
    }
  }

  if (info && info.thinks) return { ...info, efforts: [...new Set(info.efforts)] };
  if (info) return info;

  // Last resort: many providers omit capabilities entirely. Recognise common
  // reasoning families so the composer can offer Default/No Thinking; no
  // effort levels are invented beyond what the provider advertised.
  const id = typeof model.id === 'string' ? model.id.toLowerCase() : '';
  if (id && looksLikeReasoningModel(id)) {
    return { thinks: true, efforts: [], default: null };
  }

  return null;
}

export interface ModelCapabilities {
  acceptsImages: boolean;
  context: number | null;
  reasoning: ReasoningInfo | null;
}

function readVisionFlag(...values: unknown[]): boolean {
  for (const value of values) {
    if (value === true) return true;
  }
  return false;
}

/**
 * Normalizes the image/context/reasoning capabilities of a model object.
 * Shared by the engine probe and external API discovery so both modes agree.
 */
export function parseModelCapabilities(model: unknown): ModelCapabilities | null {
  if (!isRecord(model)) return null;

  const capabilities = isRecord(model.capabilities) ? model.capabilities : null;
  const features = isRecord(model.features) ? model.features : null;
  const architecture = isRecord(model.architecture) ? model.architecture : null;
  const modalities = architecture?.input_modalities
    ?? model.input_modalities
    ?? capabilities?.input_modalities
    ?? features?.input_modalities;

  const acceptsImages = readVisionFlag(model.vision, capabilities?.vision, features?.vision)
    || (Array.isArray(modalities) && modalities.includes('image'));

  const contextRaw = model.context_length
    ?? model.max_context_length
    ?? model.context
    ?? capabilities?.context_length
    ?? capabilities?.max_context_length
    ?? capabilities?.context;

  const context = typeof contextRaw === 'number' && Number.isFinite(contextRaw) ? contextRaw : null;

  return {
    acceptsImages,
    context,
    reasoning: parseReasoningFromModel(model),
  };
}

/** Conservative model-name heuristic used only when the provider is silent. */
function looksLikeReasoningModel(id: string): boolean {
  return /(^|[/:_-])(o1|o3|o4|gpt-5|deepseek-r1|deepseek-reasoner|qwq|qwen3|magistral|reasoning|thinking)([/:_.-]|$)/i.test(id)
    || /(reasoning|thinking)/i.test(id);
}

/** Recursively extracts text from the shapes reasoning providers use. */
export function reasoningText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(reasoningText).join('');
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    for (const key of ['text', 'content', 'summary', 'reasoning_content', 'reasoning']) {
      const text = reasoningText(v[key]);
      if (text) return text;
    }
  }
  return '';
}

/**
 * Reads a reasoning fragment from a streamed delta/message across the field
 * names used by OpenAI-compatible providers:
 *   reasoning_content (DeepSeek, vLLM, Splash), reasoning (OpenRouter),
 *   thinking, analysis, reasoning_details / reasoning_summary.
 */
export function readReasoningDelta(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const v = value as Record<string, unknown>;
  for (const key of ['reasoning_content', 'reasoning', 'thinking', 'analysis', 'reasoning_details', 'reasoning_summary']) {
    const text = reasoningText(v[key]);
    if (text) return text;
  }
  return '';
}
