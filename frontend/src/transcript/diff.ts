// Message/segment change detection used by the transcript diff renderer.

import type { ThreadSegment, TranscriptMessage } from '../types';

export function sameMessage(a: TranscriptMessage | null, b: TranscriptMessage): boolean {
  if (a === null) return false;
  return a.text === b.text && (a.reasoning || '') === (b.reasoning || '') && (a.error || null) === (b.error || null) && !!a.live === !!b.live &&
    (a.details || '') === (b.details || '') && (a.service || '') === (b.service || '') &&
    sameImages(a, b) && sameFiles(a, b) && sameThreadSegments(a, b);
}

export function sameThreadSegments(a: TranscriptMessage, b: TranscriptMessage): boolean {
  const sa = a.threadSegments || [];
  const sb = b.threadSegments || [];
  if (sa.length !== sb.length) return false;
  if (sa.length === 0) return true;
  return sa.every((seg, i) => {
    const bs = sb[i];
    if (seg.kind !== bs.kind) return false;
    switch (seg.kind) {
      case 'reasoning': {
        const rs = seg as Extract<ThreadSegment, { kind: 'reasoning' }>;
        const rb = bs as Extract<ThreadSegment, { kind: 'reasoning' }>;
        return rs.text === rb.text && (rs.stats || '') === (rb.stats || '') && (!!rs.contentStarted) === (!!rb.contentStarted);
      }
      case 'content': {
        const cs = seg as Extract<ThreadSegment, { kind: 'content' }>;
        const cb = bs as Extract<ThreadSegment, { kind: 'content' }>;
        return cs.text === cb.text;
      }
      default: {
        const ts = seg as Extract<ThreadSegment, { kind: 'tool' }>;
        const tb = bs as Extract<ThreadSegment, { kind: 'tool' }>;
        if (ts.serverId !== tb.serverId || ts.toolName !== tb.toolName || ts.result !== tb.result || ts.isError !== tb.isError) return false;
        if (ts.toolCallId !== tb.toolCallId || ts.approval !== tb.approval) return false;
        // Detect argument changes (covers both rawArgs streaming and parsed-object swap)
        const ta = ts.rawArgs ?? JSON.stringify(ts.arguments);
        const ba = tb.rawArgs ?? JSON.stringify(tb.arguments);
        return ta === ba;
      }
    }
  });
}

export const sameImages = (a: TranscriptMessage, b: TranscriptMessage): boolean =>
  (a.images || []).length === (b.images || []).length &&
  (a.images || []).every((img, i) => img === (b.images || [])[i]);

export const sameFiles = (a: TranscriptMessage, b: TranscriptMessage): boolean => {
  const fa = a.files || [];
  const fb = b.files || [];
  return fa.length === fb.length
    && fa.every((file, i) => file.url === fb[i].url && file.name === fb[i].name);
};
