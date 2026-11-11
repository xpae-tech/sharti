// Shared transcript edit anchoring. The transcript is bottom-aligned by a flex
// spacer, so growing an editor normally slides the edited block upward. Freeze
// the spacer while any editor is focused so the block's top edge stays put.

let activeDoc: HTMLElement | null = null;

export function beginTranscriptEditAnchor(): void {
  if (activeDoc) return;
  const doc = document.querySelector('.transcript-doc') as HTMLElement | null;
  const messages = document.querySelector('#messages') as HTMLElement | null;
  const host = document.querySelector('.transcript-host') as HTMLElement | null;
  if (!doc || !messages || !host) return;
  const spacer = Math.max(0, messages.getBoundingClientRect().top - doc.getBoundingClientRect().top);
  doc.style.setProperty('--edit-spacer', `${spacer}px`);
  doc.classList.add('editing');
  host.classList.add('editing-scroll');
  activeDoc = doc;
}

export function endTranscriptEditAnchor(): void {
  if (!activeDoc) return;
  const doc = activeDoc;
  const host = doc.closest('.transcript-host') as HTMLElement | null;
  doc.classList.remove('editing');
  doc.style.removeProperty('--edit-spacer');
  host?.classList.remove('editing-scroll');
  activeDoc = null;
}
