// Transcript markdown pipeline: sanitized links, cell line breaks, custom code
// blocks and list markers. Kept free of component state so it can be reused and
// tested independently of the DOM.

import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';

type MdInstance = ReturnType<typeof MarkdownIt>;

export const copyGlyphs = '<span class="glyph copy"></span><span class="glyph check"></span>';

const escape = (text: string): string => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const web = (url: string | null | undefined): boolean => /^(https?|mailto):/i.test(url ?? '');
const bullets = ['\u2022', '\u25e6', '\u25aa'];

const markdown = configure(MarkdownIt({ html: false, breaks: true }));

function configure(md: MdInstance): MdInstance {
  md.validateLink = () => true;
  md.core.ruler.push('splash', (state: any) => {
    let cell = false;
    for (const token of state.tokens) {
      if (token.type === 'paragraph_open' || token.type === 'paragraph_close') token.hidden = false;
      if (token.type === 'th_open' || token.type === 'td_open') cell = true;
      if (token.type === 'th_close' || token.type === 'td_close') cell = false;
      if (token.type !== 'inline') continue;
      token.children = links(token.children, state);
      if (cell) token.children = lineBreaks(token.children, state);
    }
  });
  const rules = md.renderer.rules as Record<string, (...args: any[]) => string>;
  rules.fence = (tokens: any[], index: number) =>
    code(tokens[index].content, md.utils.unescapeAll(tokens[index].info).trim().split(/\s+/)[0]);
  rules.code_block = (tokens: any[], index: number) => code(tokens[index].content, '');
  rules.bullet_list_open = (_tokens: any[], _index: number, _options: any, env: any) => { env.lists.push({ ordered: false }); return '<ul>'; };
  rules.ordered_list_open = (_tokens: any[], index: number, _options: any, env: any) => { env.lists.push({ ordered: true, next: Number(_tokens[index].attrGet('start') ?? 1) }); return '<ol>'; };
  rules.bullet_list_close = rules.ordered_list_close = (_tokens: any[], _index: number, _options: any, env: any) => env.lists.pop().ordered ? '</ol>' : '</ul>';
  rules.list_item_open = (_tokens: any[], _index: number, _options: any, env: any) => {
    const list = env.lists[env.lists.length - 1];
    const marker = list.ordered ? `${list.next++}.` : bullets[(env.lists.length - 1) % bullets.length];
    return `<li><span class="marker">${marker}</span><div class="item">`;
  };
  rules.list_item_close = () => '</div></li>';
  rules.table_open = (tokens: any[], index: number, options: any, _env: any, self: any) => '<div class="table">' + self.renderToken(tokens, index, options);
  rules.table_close = (tokens: any[], index: number, options: any, _env: any, self: any) => self.renderToken(tokens, index, options) + '</div>';
  for (const cell of ['th', 'td']) {
    rules[`${cell}_open`] = (tokens: any[], index: number, options: any, _env: any, self: any) => { tokens[index].attrs = null; return self.renderToken(tokens, index, options) + '<div>'; };
    rules[`${cell}_close`] = (tokens: any[], index: number, options: any, _env: any, self: any) => '</div>' + self.renderToken(tokens, index, options);
  }
  return md;
}

function links(children: any[], state: any): any[] {
  const kept: any[] = [];
  const dropped: boolean[] = [];
  for (const token of children) {
    if (token.type === 'link_open') {
      dropped.push(!web(token.attrGet('href')));
      if (!dropped[dropped.length - 1]) kept.push(token);
    } else if (token.type === 'link_close') {
      if (!dropped.pop()) kept.push(token);
    } else if (token.type === 'image') {
      const text = Object.assign(new state.Token('text', '', 0), { content: state.md.renderer.renderInlineAsText(token.children, {}, {}) });
      if (web(token.attrGet('src')) && !dropped.includes(false)) {
        const open = new state.Token('link_open', 'a', 1);
        open.attrs = [['href', token.attrGet('src')]];
        kept.push(open, text, new state.Token('link_close', 'a', -1));
      } else {
        kept.push(text);
      }
    } else {
      kept.push(token);
    }
  }
  return kept;
}

function lineBreaks(children: any[], state: any): any[] {
  return children.flatMap((token: any) => token.type !== 'text' ? [token] : token.content.split(/<br\s*\/?>/i).flatMap((part: string, index: number) => [
    ...(index > 0 ? [new state.Token('hardbreak', 'br', 0)] : []),
    Object.assign(new state.Token('text', '', 0), { content: part }),
  ]));
}

function code(source: string, language: string): string {
  const text = source.replace(/\n$/, '');
  const highlighted = language && hljs.getLanguage?.(language)
    ? hljs.highlight(text, { language, ignoreIllegals: true }).value
    : escape(text);
  return `<figure class="code"><figcaption><span>${escape(language)}</span>` +
    `<button type="button" class="hover copy-code" title="Copy" aria-label="Copy Code">${copyGlyphs}</button></figcaption>` +
    `<pre><code>${highlighted}</code></pre></figure>`;
}

export function renderMarkdown(text: string): string {
  try { return markdown.render(text, { lists: [] } as any); }
  catch { return `<p>${escape(text)}</p>`; }
}

/** Normalize a tool result into pretty-printed JSON wherever possible.
    Strings that already hold JSON are parsed and reformatted; values that
    aren't valid JSON are returned untouched so meaningful non-JSON output
    is never corrupted. */
export function prettyJson(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') {
    const t = value.trim();
    if (t === '') return value;
    try { return JSON.stringify(JSON.parse(t), null, 2); }
    catch { return value; }
  }
  try { const s = JSON.stringify(value, null, 2); return s !== undefined ? s : ''; }
  catch { return String(value); }
}
