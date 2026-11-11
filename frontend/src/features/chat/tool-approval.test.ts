import { describe, expect, it, vi } from 'vitest';
import { createToolApprovalGate, type ToolSeg } from './tool-approval.js';

function segment(toolCallId = 'call-1'): ToolSeg {
  return {
    kind: 'tool',
    serverId: 'sharti-agent',
    toolName: 'read_file',
    arguments: {},
    result: '',
    isError: false,
    toolCallId,
  };
}

describe('createToolApprovalGate', () => {
  it('waits for a decision and forwards corrected arguments', async () => {
    const gate = createToolApprovalGate();
    const seg = segment();
    const paint = vi.fn();
    const ctl = new AbortController();

    const decision = gate.request(seg, paint, ctl.signal);
    expect(seg.approval).toBe('pending');
    expect(paint).toHaveBeenCalledTimes(1);

    gate.resolve('call-1', 'continue', { file_path: '/tmp/x' });
    await expect(decision).resolves.toEqual({ rejected: false, args: { file_path: '/tmp/x' } });
    expect(seg.approval).toBe('approved');
    expect(seg.arguments).toEqual({ file_path: '/tmp/x' });
  });

  it('marks rejected calls without executing corrective edits', async () => {
    const gate = createToolApprovalGate();
    const seg = segment();
    const decision = gate.request(seg, () => {}, new AbortController().signal);

    gate.resolve('call-1', 'reject');
    await expect(decision).resolves.toEqual({ rejected: true, args: undefined });
    expect(seg.approval).toBe('rejected');
  });

  it('keeps the request open while correcting, then resolves it', async () => {
    const gate = createToolApprovalGate();
    const seg = segment();
    const paint = vi.fn();
    const decision = gate.request(seg, paint, new AbortController().signal);

    gate.resolve('call-1', 'correct');
    expect(seg.approval).toBe('correcting');
    expect(paint).toHaveBeenCalledTimes(2);

    gate.resolve('call-1', 'continue', { path: '/b' });
    await expect(decision).resolves.toEqual({ rejected: false, args: { path: '/b' } });
    expect(seg.approval).toBe('approved');
  });

  it('rejects the wait when the stream is aborted', async () => {
    const gate = createToolApprovalGate();
    const seg = segment();
    const ctl = new AbortController();
    const decision = gate.request(seg, () => {}, ctl.signal);

    ctl.abort();
    await expect(decision).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('ignores decisions for unknown calls', async () => {
    const gate = createToolApprovalGate();
    const seg = segment();
    const decision = gate.request(seg, () => {}, new AbortController().signal);

    gate.resolve('other', 'continue');
    expect(seg.approval).toBe('pending');
    gate.resolve('call-1', 'continue');
    await expect(decision).resolves.toEqual({ rejected: false, args: undefined });
  });
});
