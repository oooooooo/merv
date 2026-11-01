import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { prepareMarkdown } from '../merv.js';
import { imageSizes } from './pdf.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const merv = path.join(__dirname, '..', 'merv.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merv-assets-'));
const srcDir = path.join(tmp, 'src');
const workdir = path.join(tmp, 'work');
fs.mkdirSync(path.join(srcDir, 'sub'), { recursive: true });
fs.mkdirSync(workdir);
fs.writeFileSync(path.join(srcDir, 'img.png'), 'png');
fs.writeFileSync(path.join(srcDir, 'chart(v2).png'), 'png');
fs.writeFileSync(path.join(srcDir, 'icon.svg'), 'svg');
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

parentheses: ![p](./chart(v2).png)

fragment: ![f](./icon.svg#symbol)

query: ![q](./img.png?v=2)

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

    ![indented](./img.png)

span with backticks: \`\` a \` ![b](./img.png) \`\`

span across lines: \`a
![wrapped](./img.png)\`
`;

const mdPath = path.join(workdir, 'out.md');
fs.writeFileSync(mdPath, input);

try {
  const { missing } = prepareMarkdown(mdPath, srcDir, workdir);
  const md = fs.readFileSync(mdPath, 'utf8');

  // A missing image still builds, so it has to be reported; a URL, a data URI
  // and mermaid-cli's own output are not missing.
  assert.deepEqual(missing, ['./nope.png'], 'only the missing local file should be reported');
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

  for (const label of ['parentheses:', 'fragment:', 'query:']) {
    assert.match(line(label), /_assets\//, `${label} should point at a copied asset`);
  }
  assert.match(line('parentheses:'), /\]\(_assets\/[\w.-]+\)$/, 'the whole parenthesised path should be replaced');
  assert.match(line('fragment:'), /\.svg#symbol\)$/, 'the fragment should ride along onto the copy');
  assert.match(line('query:'), /\.png\?v=2\)$/, 'the query should ride along onto the copy');
  assert.match(line('title:'), /"a title"/, 'the title should survive the rewrite');
  assert.equal(line('mermaid output:'), 'mermaid output: ![diagram](out-1.svg)');
  assert.equal(line('remote:'), 'remote: ![u](https://example.com/x.png)');
  assert.equal(line('data uri:'), 'data uri: ![d](data:image/png;base64,AAAA)');
  assert.equal(line('missing:'), 'missing: ![n](./nope.png)');
  assert.equal(line('inline code:'), 'inline code: `![c](./img.png)`');
  assert.ok(md.includes('![fenced](./img.png)'), 'fenced code blocks should be left alone');
  // Code the old line-based scanner did not recognise as code.
  assert.ok(md.includes('    ![indented](./img.png)'), 'indented code should be left alone');
  assert.ok(md.includes('`` a ` ![b](./img.png) ``'), 'a span with a backtick inside should be left alone');
  assert.ok(md.includes('![wrapped](./img.png)`'), 'a span across lines should be left alone');

  const copied = fs.readdirSync(path.join(workdir, '_assets'));
  assert.ok(copied.length > 0, 'assets should be copied into the workdir');
  for (const name of copied) {
    assert.match(name, /^[\w.-]+$/, `copied name ${name} should need no URL escaping`);
  }
  // A fragment or query rides along on the reference but is not in the name.
  for (const ref of md.match(/_assets\/[^)>"'\s?#]+/g) ?? []) {
    assert.ok(fs.existsSync(path.join(workdir, ref)), `${ref} should exist`);
  }

  // ...and end to end, because rewriting the reference is only half the job: the
  // build ran from the workdir, so an image the rewrite missed reaches the PDF as
  // Chrome's broken-image icon and the run still exits 0.
  const doc = path.join(srcDir, 'doc.md');
  fs.writeFileSync(doc, '# Image\n\nlocal: ![pic](./sub/pic.png)\n');
  fs.writeFileSync(path.join(srcDir, 'sub', 'pic.png'), png(23, 7));
  const pdf = path.join(tmp, 'doc.pdf');
  const built = spawnSync(process.execPath, [merv, doc, '-o', pdf], { encoding: 'utf8' });
  assert.equal(built.status, 0, `the image build should exit 0: ${built.stdout}${built.stderr}`);

  const sizes = imageSizes(pdf);
  assert.ok(sizes.includes('23x7'), `the image should be embedded at its own size, got ${sizes}`);
  assert.ok(!sizes.includes('14x16'), `a broken-image icon was embedded instead, got ${sizes}`);

  console.log('assets test passed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// A grayscale PNG of the given size, so the PDF can be searched for an image of
// exactly those dimensions -- the broken-image icon Chrome substitutes is 14x16.
function png(width, height) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8 bits per sample
  // A row is a filter byte followed by one gray sample per pixel.
  const raw = Buffer.concat(
    Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(width, 0x40)]))
  );
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
