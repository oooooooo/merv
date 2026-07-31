import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { prepareMarkdown } from '../merv.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merv-assets-'));
const srcDir = path.join(tmp, 'src');
const workdir = path.join(tmp, 'work');
fs.mkdirSync(path.join(srcDir, 'sub'), { recursive: true });
fs.mkdirSync(workdir);
fs.writeFileSync(path.join(srcDir, 'img.png'), 'png');
fs.writeFileSync(path.join(srcDir, 'sub', '日本語 名前.png'), 'png');
// What mermaid-cli leaves next to the markdown it rewrote.
fs.writeFileSync(path.join(workdir, 'out-1.svg'), 'svg');

const input = `# t

plain: ![a](./img.png)

nested alt: ![a [b] c](./img.png)

title: ![a](./img.png "a title")

angle brackets: ![x](<./sub/日本語 名前.png>)

percent encoded: ![x](./sub/%E6%97%A5%E6%9C%AC%E8%AA%9E%20%E5%90%8D%E5%89%8D.png)

html double: <img src="./img.png" width="100">

html single: <img src='./img.png'>

html bare: <img src=./img.png>

reference: ![r][ref]

[ref]: ./img.png

mermaid output: ![diagram](out-1.svg)

remote: ![u](https://example.com/x.png)

data uri: ![d](data:image/png;base64,AAAA)

missing: ![n](./nope.png)

inline code: \`![c](./img.png)\`

\`\`\`md
![fenced](./img.png)
\`\`\`
`;

const mdPath = path.join(workdir, 'out.md');
fs.writeFileSync(mdPath, input);

try {
  prepareMarkdown(mdPath, srcDir, workdir);
  const md = fs.readFileSync(mdPath, 'utf8');
  const line = (label) => md.split('\n').find((l) => l.startsWith(label));

  for (const label of [
    'plain:',
    'nested alt:',
    'title:',
    'angle brackets:',
    'percent encoded:',
    'html double:',
    'html single:',
    'html bare:',
  ]) {
    assert.match(line(label), /_assets\//, `${label} should point at a copied asset`);
  }

  assert.match(
    md.split('\n').find((l) => l.startsWith('[ref]:')),
    /_assets\//,
    'reference definitions should point at a copied asset'
  );

  assert.match(line('title:'), /"a title"/, 'the title should survive the rewrite');
  assert.equal(line('mermaid output:'), 'mermaid output: ![diagram](out-1.svg)');
  assert.equal(line('remote:'), 'remote: ![u](https://example.com/x.png)');
  assert.equal(line('data uri:'), 'data uri: ![d](data:image/png;base64,AAAA)');
  assert.equal(line('missing:'), 'missing: ![n](./nope.png)');
  assert.equal(line('inline code:'), 'inline code: `![c](./img.png)`');
  assert.ok(md.includes('![fenced](./img.png)'), 'fenced code blocks should be left alone');

  const copied = fs.readdirSync(path.join(workdir, '_assets'));
  assert.ok(copied.length > 0, 'assets should be copied into the workdir');
  for (const name of copied) {
    assert.match(name, /^[\w.-]+$/, `copied name ${name} should need no URL escaping`);
  }
  for (const ref of md.match(/_assets\/[^)>"'\s]+/g) ?? []) {
    assert.ok(fs.existsSync(path.join(workdir, ref)), `${ref} should exist`);
  }

  console.log('assets test passed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
