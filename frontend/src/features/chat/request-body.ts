import type { ModelTuning, ServeOptions } from '../../types.js';
import { effectiveTuning, isTuningOverride } from '../../../../shared/tuning.js';

export interface RequestBodyInput {
  messages: Array<Record<string, unknown>>;
  modelId?: string;
  effort?: string;
  tools?: unknown[];
  isExternal: boolean;
  tuning?: ModelTuning;
  serveOptions?: ServeOptions | null;
}

/**
 * Builds the chat-completions body shared by the Splash engine and external
 * providers.
 *
 * `customSampling` gates sampling/reasoning attributes. Tools are controlled
 * by `toolChoice`, and request-level Splash settings (priority/timeout) are
 * independent of custom sampling.
 */
export function buildChatRequestBody(input: RequestBodyInput): Record<string, unknown> {
  const t = effectiveTuning(input.tuning, input.serveOptions);
  const active = (key: keyof ModelTuning): boolean =>
    isTuningOverride(input.tuning, key);
  const body: Record<string, unknown> = {
    messages: input.messages,
    stream: true,
    stream_options: { include_usage: true },
  };

  if (input.modelId) body.model = input.modelId;

  if (t.customSampling) {
    if (active('temperature')) body.temperature = t.temperature;
    if (active('topK')) body.top_k = t.topK;
    if (active('topP')) body.top_p = t.topP;
    if (active('minP')) body.min_p = t.minP;
    if (active('presencePenalty')) body.presence_penalty = t.presencePenalty;
    if (active('frequencyPenalty')) body.frequency_penalty = t.frequencyPenalty;
    if (active('repetitionPenalty')) body.repetition_penalty = t.repetitionPenalty;
    if (active('seed')) body.seed = t.seed;
    if (active('maxTokens')) body.max_tokens = t.maxTokens;

    if (input.effort) body.reasoning_effort = input.effort;
    if (active('thinkingTokenBudget') && t.thinkingTokenBudget >= 0) {
      body.thinking_token_budget = t.thinkingTokenBudget;
    }

    if (!input.isExternal) body.return_progress = true;
  }

  // Request-level settings are independent of Custom Sampling.
  // Splash-specific extensions; external providers must never see them.
  if (!input.isExternal) {
    if (active('priority')) body.priority = t.priority;
    if (active('timeout') && t.timeout > 0) body.timeout = t.timeout;
  }

  if (t.toolChoice && input.tools && input.tools.length > 0) {
    body.tools = input.tools;
    body.tool_choice = 'auto';
    // Splash-only: the engine supports and defaults this to true. External
    // providers are not guaranteed to accept the field, so never send it there.
    if (!input.isExternal) body.parallel_tool_calls = t.parallelToolCalls;
  }

  return body;
}
