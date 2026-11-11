/**
 * Reads a tokens-per-second value from the stream shapes used by common
 * OpenAI-compatible servers. Splash reports it under `metrics`; llama.cpp
 * under `timings`; LM Studio/others may report `stats` or `usage`.
 */
export function readTokensPerSecond(chunk: unknown): number | null {
  if (!chunk || typeof chunk !== 'object') return null;
  const c = chunk as Record<string, any>;
  const candidates = [
    c.metrics?.request_latency?.stream_tokens_per_second,
    c.metrics?.request_latency?.decode_tokens_per_second,
    c.metrics?.stream_tokens_per_second,
    c.metrics?.tokens_per_second,
    c.timings?.predicted_per_second,
    c.stats?.tokens_per_second,
    c.usage?.tokens_per_second,
  ];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return null;
}
