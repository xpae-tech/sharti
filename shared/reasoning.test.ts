import { describe, expect, it } from 'vitest';
import { parseReasoning } from './reasoning.js';

describe('parseReasoning', () => {
  it('normalizes boolean values', () => {
    expect(parseReasoning(true)).toEqual({ thinks: true, efforts: [], default: null });
    expect(parseReasoning(false)).toBeNull();
  });

  it('normalizes object values and aliases', () => {
    expect(parseReasoning({ supported: true, efforts: ['low', 'high'], defaultEffort: 'low' })).toEqual({
      thinks: true,
      efforts: ['low', 'high'],
      default: 'low',
    });
  });

  it('treats missing input as unsupported', () => {
    expect(parseReasoning(undefined)).toBeNull();
  });
});

import { readReasoningDelta } from './reasoning.js';

describe('readReasoningDelta', () => {
  it('supports the common provider field names', () => {
    expect(readReasoningDelta({ reasoning_content: 'deep' })).toBe('deep');
    expect(readReasoningDelta({ reasoning: 'openrouter' })).toBe('openrouter');
    expect(readReasoningDelta({ thinking: 'thinking' })).toBe('thinking');
    expect(readReasoningDelta({ analysis: 'analysis' })).toBe('analysis');
  });

  it('flattens structured reasoning details', () => {
    expect(readReasoningDelta({ reasoning_details: [{ text: 'one ' }, { summary: 'two' }] })).toBe('one two');
    expect(readReasoningDelta({ reasoning: { text: 'nested' } })).toBe('nested');
  });

  it('ignores empty and unrelated values', () => {
    expect(readReasoningDelta({})).toBe('');
    expect(readReasoningDelta({ content: 'not reasoning' })).toBe('');
    expect(readReasoningDelta(null)).toBe('');
  });
});


import { parseReasoningFromModel } from './reasoning.js';

describe('parseReasoningFromModel', () => {
  it('reads Splash / LM Studio descriptors', () => {
    expect(parseReasoningFromModel({ id: 'qwen', reasoning: { supported: true, efforts: ['low', 'high'], defaultEffort: 'low' } }))
      .toEqual({ thinks: true, efforts: ['low', 'high'], default: 'low' });
  });

  it('does not invent levels from supported_parameters alone', () => {
    expect(parseReasoningFromModel({ id: 'openai/gpt-5', supported_parameters: ['reasoning', 'reasoning_effort'] }))
      .toEqual({ thinks: true, efforts: [], default: null });
  });

  it('reads LM Studio allowed_options', () => {
    expect(parseReasoningFromModel({
      id: 'qwen3.8-27b',
      capabilities: { reasoning: { allowed_options: ['off', 'on', 'low', 'medium', 'high'], default: 'on' } },
    })).toEqual({ thinks: true, efforts: ['off', 'on', 'low', 'medium', 'high'], default: 'on' });
  });

  it('reads capability objects and nested defaults', () => {
    expect(parseReasoningFromModel({
      id: 'provider/model',
      capabilities: { reasoning: { supported: true, efforts: ['low', 'medium'] } },
      default_parameters: { reasoning_effort: 'medium' },
    })).toEqual({ thinks: true, efforts: ['low', 'medium'], default: 'medium' });
  });

  it('falls back to model-family names when the provider is silent', () => {
    expect(parseReasoningFromModel({ id: 'deepseek-r1:8b' })).toEqual({ thinks: true, efforts: [], default: null });
    expect(parseReasoningFromModel({ id: 'llama-3' })).toBeNull();
  });
});

import { parseModelCapabilities } from './reasoning.js';

describe('parseModelCapabilities', () => {
  it('reads vision from flags and OpenRouter-style modalities', () => {
    expect(parseModelCapabilities({ id: 'a', vision: true })?.acceptsImages).toBe(true);
    expect(parseModelCapabilities({ id: 'b', architecture: { input_modalities: ['text', 'image'] } })?.acceptsImages).toBe(true);
    expect(parseModelCapabilities({ id: 'c', capabilities: { vision: true } })?.acceptsImages).toBe(true);
    expect(parseModelCapabilities({ id: 'd', vision: false })?.acceptsImages).toBe(false);
  });

  it('normalizes context and reasoning together', () => {
    expect(parseModelCapabilities({
      id: '~openai/gpt-latest',
      context_length: 1050000,
      supported_parameters: ['reasoning', 'reasoning_effort'],
    })).toEqual({
      acceptsImages: false,
      context: 1050000,
      reasoning: { thinks: true, efforts: [], default: null },
    });
  });
});

import { effortWeight, sortEffortsForMenu } from './reasoning.js';

describe('effortWeight', () => {
  it('orders menu efforts from max at the top to none at the bottom', () => {
    const efforts = ['max', 'high', 'none', 'medium', 'low', 'xhigh', 'minimal', 'default'];
    expect(sortEffortsForMenu(efforts))
      .toEqual(['max', 'xhigh', 'high', 'medium', 'low', 'default', 'minimal', 'none']);
  });

  it('treats off as none and default as low', () => {
    expect(effortWeight('off')).toBe(0);
    expect(effortWeight('')).toBe(1);
    expect(effortWeight('default')).toBe(1);
  });
});
