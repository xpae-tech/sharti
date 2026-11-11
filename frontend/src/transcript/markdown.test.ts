import { describe, expect, it } from 'vitest';
import { prettyJson, renderMarkdown } from './markdown.js';

describe('renderMarkdown', () => {
  it('renders emphasis and keeps safe links', () => {
    expect(renderMarkdown('**hi**')).toContain('<strong>hi</strong>');
    expect(renderMarkdown('[docs](https://example.com)')).toContain('href="https://example.com"');
  });

  it('drops unsafe link targets but keeps their text', () => {
    const html = renderMarkdown('[click](javascript:alert(1))');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('click');
  });

  it('escapes raw HTML', () => {
    expect(renderMarkdown('<b>x</b>')).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('uses custom list markers and table wrappers', () => {
    const list = renderMarkdown('- one\n- two');
    expect(list).toContain('<span class="marker">\u2022</span>');
    expect(list).toContain('<div class="item">');

    const table = renderMarkdown('| a | b |\n| - | - |\n| 1 | 2 |');
    expect(table).toContain('<div class="table">');
    expect(table).toContain('<div>1</div>');
  });

  it('highlights fenced code and adds the copy affordance', () => {
    const html = renderMarkdown('```js\nconst a = 1;\n```');
    expect(html).toContain('<figure class="code">');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('copy-code');
  });
});

describe('prettyJson', () => {
  it('reformats JSON strings', () => {
    expect(prettyJson('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('leaves non-JSON strings untouched', () => {
    expect(prettyJson('not json')).toBe('not json');
    expect(prettyJson('')).toBe('');
  });

  it('pretty-prints objects and serializes null as empty', () => {
    expect(prettyJson({ a: [1, 2] })).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
    expect(prettyJson(null)).toBe('');
    expect(prettyJson(undefined)).toBe('');
  });
});
