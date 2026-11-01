import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { prepareMarkdown } from '../merv.js';
import { pageCount } from './pdf.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const merv = path.join(__dirname, '..', 'merv.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merv-diagram-'));

try {
  // The sizing rule is aimed at the images mermaid-cli writes, and only a
  // document holding one needs it.
  const workdir = path.join(tmp, 'work');
  fs.mkdirSync(workdir);
  fs.writeFileSync(path.join(workdir, 'out-1.svg'), 'svg');
  const withDiagram = path.join(workdir, 'out.md');
  fs.writeFileSync(withDiagram, '# t\n\n![diagram](./out-1.svg)\n');
  prepareMarkdown(withDiagram, tmp, workdir);
  assert.match(
    fs.readFileSync(withDiagram, 'utf8'),
    /<style>[\s\S]*img\[src\^="\.\/out-"\][\s\S]*<\/style>\s*$/,
    'a document with a diagram should carry the sizing rule'
  );

  // A diagram taller than a page used to run on over two, because an image
  // cannot be split; fitted to the page area, it takes one.
  const tall = path.join(tmp, 'tall.md');
  const edges = Array.from({ length: 40 }, (_, i) => `  n${i} --> n${i + 1}`).join('\n');
  fs.writeFileSync(tall, `\`\`\`mermaid\nflowchart TD\n${edges}\n\`\`\`\n`);
  const pdf = path.join(tmp, 'tall.pdf');
  const result = spawnSync(process.execPath, [merv, tall, '-o', pdf], { encoding: 'utf8' });
  assert.equal(result.status, 0, `build failed: ${result.stdout}${result.stderr}`);
  assert.equal(pageCount(pdf), 1, 'a tall diagram should be shrunk onto one page');

  console.log('diagram test passed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
