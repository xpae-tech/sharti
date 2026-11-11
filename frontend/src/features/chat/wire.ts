// Wire-message construction for the chat-completions request. Pure with
// respect to UI state: callers pass the current capability/config snapshot and
// an image resolver, which makes the shape testable without a browser.

import { getMessageFiles, getMessageImages, getMessageReasoning, getMessageText, chatFileUrl } from '../../types';
import type { Conversation, FilePart, ImagePart, TextPart } from '../../types';

export type AttachmentResolver = (chatId: string, part: ImagePart | FilePart) => Promise<string | null>;

export interface WireMessageOptions {
  /** Whether the active service accepts image and PDF parts. */
  acceptsImages: boolean;
  /** Already-resolved system prompt (empty string when disabled). */
  systemPrompt: string;
  /** Override for tests and non-browser callers. */
  resolveAttachment?: AttachmentResolver;
}

export async function buildInitialWireMessages(
  conv: Conversation,
  opts: WireMessageOptions,
): Promise<Array<Record<string, unknown>>> {
  const resolveAttachment = opts.resolveAttachment ?? resolveChatFileDataUrl;
  const wire = conv.messages
    .filter((m) => !(m.role === 'assistant' && !getMessageText(m) && !getMessageReasoning(m)))
    .map(async (m): Promise<Record<string, unknown>> => {
      if (m.role === 'user') {
        const texts = m.parts.filter((p) => p.type === 'text') as TextPart[];
        const images = getMessageImages(m);
        const files = getMessageFiles(m);
        const textStr = texts.map((t) => t.text).join('\n');

        if ((images.length || files.length) && opts.acceptsImages) {
          const content: Record<string, unknown>[] = [];
          for (const img of images) {
            const dataUrl = await resolveAttachment(conv.id, img);
            if (dataUrl) content.push({ type: 'image_url', image_url: { url: dataUrl } });
          }
          for (const file of files) {
            const dataUrl = await resolveAttachment(conv.id, file);
            if (dataUrl) {
              content.push({
                type: 'file',
                file: { file_data: dataUrl, filename: file.originalName || file.fileName },
              });
            }
          }
          content.push({ type: 'text', text: textStr });
          return { role: 'user', content };
        }
        if (images.length || files.length) {
          const notes: string[] = [];
          if (images.length) notes.push(images.length === 1 ? "[An image this model can't see]" : `[${images.length} images this model can't see]`);
          if (files.length) notes.push(files.length === 1 ? "[A PDF this model can't see]" : `[${files.length} PDFs this model can't see]`);
          const note = notes.join('\n');
          return { role: 'user', content: textStr ? `${note}\n\n${textStr}` : note };
        }
        return { role: 'user', content: textStr };
      }
      return { role: 'assistant', content: getMessageText(m), reasoning_content: getMessageReasoning(m) };
    });
  const messages = await Promise.all(wire);
  return opts.systemPrompt
    ? [{ role: 'system', content: opts.systemPrompt }, ...messages]
    : messages;
}

const MAX_ATTACHMENT_CACHE_CHARS = 64 * 1024 * 1024;
const attachmentDataUrls = new Map<string, string>();
let cachedChars = 0;

function cacheDataUrl(key: string, value: string): void {
  if (value.length > MAX_ATTACHMENT_CACHE_CHARS) return;
  const previous = attachmentDataUrls.get(key);
  if (previous !== undefined) {
    cachedChars -= previous.length;
    attachmentDataUrls.delete(key);
  }
  attachmentDataUrls.set(key, value);
  cachedChars += value.length;
  while (cachedChars > MAX_ATTACHMENT_CACHE_CHARS) {
    const first = attachmentDataUrls.keys().next();
    if (first.done) break;
    const old = attachmentDataUrls.get(first.value);
    attachmentDataUrls.delete(first.value);
    if (old !== undefined) cachedChars -= old.length;
  }
}

/** Resolve a chat attachment to a data URL, preferring the in-memory upload map. */
export async function resolveChatFileDataUrl(
  chatId: string,
  part: ImagePart | FilePart,
  sessionMap?: Map<string, string>,
): Promise<string | null> {
  const key = `${chatId}\u0000${part.fileName}`;
  const uploaded = sessionMap?.get(part.fileName);
  if (uploaded) {
    cacheDataUrl(key, uploaded);
    return uploaded;
  }
  const cached = attachmentDataUrls.get(key);
  if (cached) return cached;
  try {
    const resp = await fetch(chatFileUrl(chatId, part.fileName));
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const dataUrl = await blobToDataUrl(blob);
    cacheDataUrl(key, dataUrl);
    return dataUrl;
  } catch { return null; }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}
