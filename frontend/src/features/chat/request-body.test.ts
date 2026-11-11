import { describe, expect, it } from 'vitest';
import { buildChatRequestBody } from './request-body.js';

const messages = [{ role: 'user', content: 'hi' }];
const tools = [{ type: 'function', function: { name: 'read_file' } }];

describe('buildChatRequestBody', () => {
  it('sends the tuning profile for the engine', () => {
    const body = buildChatRequestBody({
      messages,
      isExternal: false,
      tuning: { customSampling: true, temperature: 0.4, topK: 12, maxTokens: 800, timeout: 45 },
      serveOptions: {},
      effort: 'high',
      tools,
    });

    expect(body.temperature).toBe(0.4);
    expect(body.top_k).toBe(12);
    expect(body.max_tokens).toBe(800);
    expect(body.reasoning_effort).toBe('high');
    expect(body.priority).toBeUndefined();
    expect(body.return_progress).toBe(true);
    expect(body.timeout).toBe(45);
    expect(body.tools).toEqual(tools);
    expect(body.tool_choice).toBe('auto');
  });

  it('omits tuning attributes when customSampling is off', () => {
    const body = buildChatRequestBody({
      messages,
      isExternal: true,
      tuning: { customSampling: false, temperature: 0.4, thinkingTokenBudget: 512 },
      serveOptions: {},
      effort: 'high',
      tools,
    });

    expect(body).toEqual({
      messages,
      stream: true,
      stream_options: { include_usage: true },
      tools,
      tool_choice: 'auto',
    });
  });

  it('hides tools when toolChoice is off', () => {
    const body = buildChatRequestBody({
      messages,
      isExternal: true,
      tuning: { toolChoice: false },
      serveOptions: {},
      tools,
    });
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
    expect(body.parallel_tool_calls).toBeUndefined();
  });

  it('sends only fields explicitly changed from their defaults', () => {
    const body = buildChatRequestBody({
      messages,
      isExternal: false,
      tuning: { customSampling: true, temperature: 0.4 },
      serveOptions: {},
    });

    expect(body.temperature).toBe(0.4);
    expect(body.top_k).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.max_tokens).toBeUndefined();
    expect(body.priority).toBeUndefined();
  });

  it('sends stored values even when they equal the defaults', () => {
    const body = buildChatRequestBody({
      messages,
      isExternal: false,
      tuning: { customSampling: true, temperature: 1, priority: 'normal', topK: 20 },
      serveOptions: {},
    });

    expect(body.temperature).toBe(1);
    expect(body.top_k).toBe(20);
    expect(body.priority).toBe('normal');
  });

  it('does not send Splash-only fields to external APIs', () => {
    const body = buildChatRequestBody({
      messages,
      isExternal: true,
      tuning: { customSampling: true, timeout: 60, thinkingTokenBudget: 100, priority: 'background', parallelToolCalls: true },
      serveOptions: {},
      tools,
    });
    expect(body.priority).toBeUndefined();
    expect(body.parallel_tool_calls).toBeUndefined();
    expect(body.return_progress).toBeUndefined();
    expect(body.thinking_token_budget).toBe(100);
  });

  it('sends parallel_tool_calls to the engine with the effective value', () => {
    const on = buildChatRequestBody({
      messages,
      isExternal: false,
      tuning: { parallelToolCalls: true },
      serveOptions: {},
      tools,
    });
    expect(on.parallel_tool_calls).toBe(true);

    const off = buildChatRequestBody({
      messages,
      isExternal: false,
      tuning: {},
      serveOptions: {},
      tools,
    });
    expect(off.parallel_tool_calls).toBe(false);
  });
});

describe('request-level settings are independent of custom sampling', () => {
  it('sends priority and timeout to the engine when custom sampling is off', () => {
    const body = buildChatRequestBody({
      messages,
      isExternal: false,
      tuning: { customSampling: false, priority: 'background', timeout: 30 },
      serveOptions: {},
    });
    expect(body.temperature).toBeUndefined();
    expect(body.priority).toBe('background');
    expect(body.timeout).toBe(30);
  });
});
