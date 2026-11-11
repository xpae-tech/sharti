// Chat-completions transport: timeout/abort scope plus retry-on-transient-error
// semantics for the agent loop. Kept separate from the streaming parser so the
// network policy can be reviewed and tested independently.

import { REQUEST } from '../../core/config.js';

interface OpenedStream {
  res: Response;
  timedOut: () => boolean;
  cleanup: () => void;
}

/** Combines the user's abort signal with an optional per-request timeout. */
function createAbortScope(parent: AbortSignal, timeoutSec: number): {
  signal: AbortSignal;
  timedOut: () => boolean;
  cleanup: () => void;
} {
  const ctrl = new AbortController();
  let didTimeout = false;

  const onParentAbort = (): void => ctrl.abort(parent.reason);
  if (parent.aborted) ctrl.abort(parent.reason);
  else parent.addEventListener('abort', onParentAbort, { once: true });

  let timer: ReturnType<typeof setTimeout> | null = null;
  if (timeoutSec > 0) {
    timer = setTimeout(() => {
      didTimeout = true;
      ctrl.abort(new DOMException('Request timed out', 'TimeoutError'));
    }, timeoutSec * 1000);
  }

  return {
    signal: ctrl.signal,
    timedOut: () => didTimeout,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      parent.removeEventListener('abort', onParentAbort);
    },
  };
}

/** Abort-aware delay used between retry attempts. */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason ?? new DOMException('Aborted', 'AbortError')); return; }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Opens the completions stream with retry-on-transient-error semantics.
 * The returned scope stays active while the body is being consumed so the
 * configured timeout also covers a stalled stream, not just the handshake.
 */
export async function openChatStream(
  chatId: string,
  body: Record<string, unknown>,
  parent: AbortSignal,
  timeoutSec: number,
  maxRetries: number,
): Promise<OpenedStream> {
  const attempts = Math.max(0, Math.min(REQUEST.maxRetries, Math.floor(maxRetries)));
  for (let attempt = 0; ; attempt++) {
    const scope = createAbortScope(parent, timeoutSec);
    let res: Response;
    try {
      res = await fetch('/proxy/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Chat-Id': chatId },
        body: JSON.stringify(body),
        signal: scope.signal,
      });
    } catch (e) {
      const timedOut = scope.timedOut();
      scope.cleanup();
      if (parent.aborted) throw e;
      if (timedOut) throw new Error(`Request timed out after ${timeoutSec}s.`);
      if (attempt < attempts) {
        await abortableDelay(Math.min(REQUEST.retryBaseDelayMs * 2 ** attempt, REQUEST.retryMaxDelayMs), parent);
        continue;
      }
      throw e;
    }

    if (!res.ok && REQUEST.retryableStatuses.has(res.status) && attempt < attempts) {
      try { await res.body?.cancel(); } catch { /* noop */ }
      scope.cleanup();
      await abortableDelay(Math.min(REQUEST.retryBaseDelayMs * 2 ** attempt, REQUEST.retryMaxDelayMs), parent);
      continue;
    }

    return { res, timedOut: scope.timedOut, cleanup: scope.cleanup };
  }
}
