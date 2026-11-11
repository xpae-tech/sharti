// Tool approval gate: the agent loop is sequential, so at most one tool call
// waits for a user decision. This module owns that single pending request and
// the decision handling, independent of the transcript/DOM.

import type { ThreadSegment } from '../../types';

export type ToolSeg = Extract<ThreadSegment, { kind: 'tool' }>;
export type ToolApprovalAction = 'continue' | 'reject' | 'correct';

export interface ToolApprovalDecision {
  rejected: boolean;
  args?: Record<string, unknown>;
}

interface PendingApproval {
  toolCallId: string;
  segment: ToolSeg;
  paint: () => void;
  resolve: (decision: ToolApprovalDecision) => void;
}

export interface ToolApprovalGate {
  request(segment: ToolSeg, paint: () => void, signal: AbortSignal): Promise<ToolApprovalDecision>;
  resolve(id: string, action: ToolApprovalAction, args?: Record<string, unknown>): void;
}

export function createToolApprovalGate(): ToolApprovalGate {
  let pending: PendingApproval | null = null;

  function request(
    segment: ToolSeg,
    paint: () => void,
    signal: AbortSignal,
  ): Promise<ToolApprovalDecision> {
    const toolCallId = segment.toolCallId ?? '';
    segment.approval = 'pending';
    paint();
    return new Promise<ToolApprovalDecision>((resolve, reject) => {
      const onAbort = (): void => {
        if (pending?.toolCallId === toolCallId) pending = null;
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
      pending = {
        toolCallId,
        segment,
        paint,
        resolve: (decision) => {
          signal.removeEventListener('abort', onAbort);
          resolve(decision);
        },
      };
    });
  }

  function resolve(id: string, action: ToolApprovalAction, args?: Record<string, unknown>): void {
    const req = pending;
    if (!req || req.toolCallId !== id) return;
    if (action === 'correct') {
      req.segment.approval = 'correcting';
      req.paint();
      return;
    }
    if (action === 'continue' && args) req.segment.arguments = args;
    req.segment.approval = action === 'reject' ? 'rejected' : 'approved';
    pending = null;
    req.paint();
    req.resolve({ rejected: action === 'reject', args });
  }

  return { request, resolve };
}
