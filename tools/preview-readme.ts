import fs from 'node:fs';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const README = path.join(ROOT, 'README.md');
const OUTPUT = path.join(ROOT, '.readme-preview.html');

function repoContext(): string {
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim();
    const match = remote.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/);
    if (match) return `${match[1]}/${match[2]}`;
  } catch {
    // No git remote available; GitHub renders without repo context.
  }
  return '';
}

function openInBrowser(file: string): void {
  const [command, args] =
    process.platform === 'darwin'
      ? ['open', [file]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', file]]
        : ['xdg-open', [file]];
  execFile(command, args, (error) => {
    if (error) console.error(`[readme] open ${file} manually`);
  });
}

const markdown = fs.readFileSync(README, 'utf8');

const response = await fetch('https://api.github.com/markdown', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'user-agent': 'sharti-readme-preview',
  },
  body: JSON.stringify({
    text: markdown,
    mode: 'gfm',
    context: repoContext(),
  }),
});

if (!response.ok) {
  console.error(`[readme] GitHub render failed: ${response.status} ${await response.text()}`);
  process.exitCode = 1;
} else {
  const body = await response.text();
  const base = pathToFileURL(ROOT + path.sep).href;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<base href="${base}">
<title>README preview</title>
<style>
  body {
    box-sizing: border-box;
    max-width: 980px;
    margin: 0 auto;
    padding: 32px;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #1f2328;
    background: #fff;
  }
  [align="center"] { text-align: center; }
  img { max-width: 100%; }
  a { color: #0969da; }
  h1, h2 { border-bottom: 1px solid #d0d7de; padding-bottom: .3em; }
  code { background: #f6f8fa; padding: 2px 4px; border-radius: 4px; }
  pre { background: #f6f8fa; padding: 12px; overflow: auto; border-radius: 6px; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #d0d7de; padding: 6px 13px; }
  blockquote { color: #59636e; border-left: 4px solid #d0d7de; margin: 0; padding: 0 1em; }
</style>
</head>
<body>
${body}
</body>
</html>`;

  fs.writeFileSync(OUTPUT, html);
  console.log(`[readme] preview written to ${OUTPUT}`);
  openInBrowser(OUTPUT);
}
