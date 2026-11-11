// Attachment picking and processing for the composer: images and PDFs.
// DraftAttachment carries both the File (for upload) and a dataUrl (for previews).

import { S } from '../core/state.js';
import { isPdfFile } from '../types';
import type { DraftAttachment } from '../types';

interface AttachmentDeps {
  renderAttachments: () => void;
  updateSendState: () => void;
}

/** Files the composer can hand to a vision-capable model. */
export function isSupportedAttachment(file: File): boolean {
  return file.type.startsWith('image/') || isPdfFile(file);
}

export function createAttachmentHandler(deps: AttachmentDeps) {
  function pickAttachments(): void {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*,application/pdf';
    inp.multiple = true;
    inp.onchange = () => addAttachmentFiles([...(inp.files || [])]);
    inp.click();
  }

  function addAttachmentFiles(files: File[]): void {
    files.filter(isSupportedAttachment).forEach((f) => {
      // PDFs show a name-only tile, so reading their whole payload here would
      // only allocate an unused base64 copy. It is read lazily at send time.
      const attachment: DraftAttachment = { file: f, dataUrl: '' };
      if (isPdfFile(f)) {
        S.draft.attachments.push(attachment);
        deps.renderAttachments();
        deps.updateSendState();
        return;
      }
      const fr = new FileReader();
      fr.onload = () => {
        attachment.dataUrl = fr.result as string;
        S.draft.attachments.push(attachment);
        deps.renderAttachments();
        deps.updateSendState();
      };
      fr.readAsDataURL(f);
    });
  }

  return { pickAttachments, addAttachmentFiles };
}
