/** Replace a container's block children with freshly rendered markdown,
    preserving nodes that are structurally unchanged. */
export function patch(container: HTMLElement, html: string): void {
  for (const child of [...container.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE && child.nodeValue!.trim()) child.remove();
  }
  const fresh = document.createElement('div');
  fresh.innerHTML = html;
  const blocks = [...fresh.children];
  const old = [...container.children];
  blocks.forEach((block, index) => {
    if (index >= old.length) container.append(block);
    else if (!old[index].isEqualNode(block)) old[index].replaceWith(block);
  });
  for (const extra of old.slice(blocks.length)) extra.remove();
}
