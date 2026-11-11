import { describe, expect, it, vi } from 'vitest';
import { buildInitialWireMessages } from './wire.js';
import type { Conversation, FilePart, ImagePart } from '../../types';

function conversation(messages: Conversation['messages']): Conversation {
  return {
    id: 'chat-1', name: 'Chat', createdAt: 1, updatedAt: 1, tokenCount: 0,
    userLastMessagedAt: null, assistantLastMessagedAt: null,
    messages, files: [],
  };
}

const image: ImagePart = { type: 'image', fileName: 'a.png', mimeType: 'image/png' };
const pdf: FilePart = { type: 'file', fileName: 'b.pdf', mimeType: 'application/pdf', originalName: 'notes.pdf' };

describe('buildInitialWireMessages', () => {
  it('maps text, assistant reasoning and prepends the system prompt', async () => {
    const conv = conversation([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }], ts: 1 },
      { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'hello' }], reasoning: 'thought', ts: 2 },
    ]);

    const wire = await buildInitialWireMessages(conv, { acceptsImages: false, systemPrompt: 'Be brief.' });
    expect(wire).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello', reasoning_content: 'thought' },
    ]);
  });

  it('skips empty assistant placeholders', async () => {
    const conv = conversation([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hi' }], ts: 1 },
      { id: 'a1', role: 'assistant', parts: [], ts: 2, live: true },
    ]);

    const wire = await buildInitialWireMessages(conv, { acceptsImages: false, systemPrompt: '' });
    expect(wire).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('embeds resolvable images when the service accepts them', async () => {
    const conv = conversation([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'look' }, image], ts: 1 },
    ]);
    const resolveAttachment = vi.fn(async () => 'data:image/png;base64,AAA');

    const wire = await buildInitialWireMessages(conv, {
      acceptsImages: true,
      systemPrompt: '',
      resolveAttachment,
    });

    expect(resolveAttachment).toHaveBeenCalledWith('chat-1', image);
    expect(wire[0].content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      { type: 'text', text: 'look' },
    ]);
  });

  it('replaces unseen images with a text note', async () => {
    const conv = conversation([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'look' }, image], ts: 1 },
      { id: 'u2', role: 'user', parts: [image], ts: 2 },
    ]);

    const wire = await buildInitialWireMessages(conv, { acceptsImages: false, systemPrompt: '' });
    expect(wire[0]).toEqual({ role: 'user', content: "[An image this model can't see]\n\nlook" });
    expect(wire[1]).toEqual({ role: 'user', content: "[An image this model can't see]" });
  });

  it('sends PDFs as inline file parts', async () => {
    const conv = conversation([
      { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'read' }, pdf], ts: 1 },
    ]);
    const resolveAttachment = vi.fn(async () => 'data:application/pdf;base64,PDF');

    const wire = await buildInitialWireMessages(conv, {
      acceptsImages: true,
      systemPrompt: '',
      resolveAttachment,
    });

    expect(resolveAttachment).toHaveBeenCalledWith('chat-1', pdf);
    expect(wire[0].content).toEqual([
      { type: 'file', file: { file_data: 'data:application/pdf;base64,PDF', filename: 'notes.pdf' } },
      { type: 'text', text: 'read' },
    ]);
  });

  it('notes PDFs the model cannot see', async () => {
    const conv = conversation([{ id: 'u1', role: 'user', parts: [pdf], ts: 1 }]);
    const wire = await buildInitialWireMessages(conv, { acceptsImages: false, systemPrompt: '' });
    expect(wire[0]).toEqual({ role: 'user', content: "[A PDF this model can't see]" });
  });

  it('drops images the resolver cannot load', async () => {
    const conv = conversation([{ id: 'u1', role: 'user', parts: [image], ts: 1 }]);
    const wire = await buildInitialWireMessages(conv, {
      acceptsImages: true,
      systemPrompt: '',
      resolveAttachment: async () => null,
    });

    expect(wire[0].content).toEqual([{ type: 'text', text: '' }]);
  });
});
