import { SSE } from '../config/index.js';

type Listener = (evt: string) => void;

/**
 * Topic-based Server-Sent Events broadcaster.
 * Compatible with Hono's Web Standard Response model.
 */
export class SseHub {
  private listeners = new Set<Listener>();

  /** Subscribe to all events. Returns unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Broadcast an event to all subscribers. */
  broadcast(topic: string, payload: unknown): void {
    const evt = `event: ${topic}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const listener of this.listeners) {
      try { listener(evt); } catch { /* listener error */ }
    }
  }


  /** Destroy all subscriptions. */
  destroy(): void {
    this.listeners.clear();
  }
}

/**
 * Creates a ReadableStream suitable for Hono's SSE endpoint.
 * Emits a heartbeat comment every 15 seconds to keep connection alive.
 */
export function createSseStream(hub: SseHub): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  return new ReadableStream({
    start(controller) {
      const enqueue = (text: string): void => {
        try { controller.enqueue(encoder.encode(text)); } catch { /* closed */ }
      };

      // Initial retry directive
      enqueue('retry: 2000\n\n');

      // Subscribe to hub
      unsub = hub.subscribe(enqueue);

      // Heartbeat
      heartbeat = setInterval(() => enqueue(': ping\n\n'), SSE.heartbeatMs);

    },
    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      if (unsub) unsub();
    },
  });
}
