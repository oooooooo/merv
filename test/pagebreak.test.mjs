import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

import { prepareMarkdown } from '../merv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const merv = path.join(__dirname, '..', 'merv.js');
const fixture = path.join(__dirname, 'fixtures', 'pagebreak.md');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merv-pagebreak-'));

// The page tree records its size, but PDF 1.5 keeps it in a compressed object
// stream, so the whole file has to be inflated before it can be read.
function pageCount(pdf) {
  const buf = fs.readFileSync(pdf);
  let text = '';
  for (let i = buf.indexOf('stream'); i >= 0; i = buf.indexOf('stream', i)) {
    let start = i + 6;
    if (buf[start] === 13) start++;
    if (buf[start] === 10) start++;
    const end = buf.indexOf('endstream', start);
    if (end < 0) break;
    try {
      text += zlib.inflateSync(buf.subarray(start, end)).toString('latin1');
    } catch {}
    i = end + 9;
  }
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(counts.length > 0, `could not read a page count from ${pdf}`);
  return Math.max(...counts);
}

function build(input, output, theme) {
  const args = [merv, input, '-o', output, ...(theme ? ['-T', theme] : [])];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, `build failed: ${result.stdout}${result.stderr}`);
  return pageCount(output);
}

try {
  // The marker is a comment: it must survive as a break, and only as a break.
  const workdir = path.join(tmp, 'work');
  fs.mkdirSync(workdir);
  const mdPath = path.join(workdir, 'out.md');
  fs.writeFileSync(
    mdPath,
    [
      '<!-- pagebreak -->',
      '<!--pagebreak-->',
      '<!--   PageBreak   -->',
      'text <!-- pagebreak --> text',
      '<!-- not a pagebreak -->',
      '```md',
      '<!-- pagebreak -->',
      '```',
    ].join('\n')
  );
  prepareMarkdown(mdPath, tmp, workdir);
  const lines = fs.readFileSync(mdPath, 'utf8').split('\n');

  for (const [i, label] of [
    [0, 'canonical'],
    [1, 'unspaced'],
    [2, 'mixed case'],
    [3, 'inline'],
  ]) {
    assert.match(lines[i], /merv-pagebreak/, `the ${label} marker should become a break`);
    assert.doesNotMatch(lines[i], /<!--/, `the ${label} marker should be consumed`);
  }
  assert.equal(lines[4], '<!-- not a pagebreak -->', 'other comments should be left alone');
  assert.equal(lines[6], '<!-- pagebreak -->', 'fenced markers should be left alone');

  // Themes bring their own page rules, so the break has to hold under any of
  // them. theme-slide is the hard case: it lays each section out as a fixed
  // height flex box, which offers no break opportunity inside.
  for (const theme of [null, '@vivliostyle/theme-slide']) {
    const name = theme ?? 'default';
    const stripped = path.join(tmp, `stripped-${name.replace(/\W/g, '_')}.md`);
    fs.writeFileSync(
      stripped,
      fs.readFileSync(fixture, 'utf8').replace(/<!--\s*pagebreak\s*-->/gi, '')
    );

    const withBreaks = build(fixture, path.join(tmp, `with-${name.replace(/\W/g, '_')}.pdf`), theme);
    const withoutBreaks = build(stripped, path.join(tmp, `without-${name.replace(/\W/g, '_')}.pdf`), theme);
    assert.ok(
      withBreaks >= withoutBreaks + 2,
      `${name}: two markers should add two pages (${withoutBreaks} -> ${withBreaks})`
    );
  }

  console.log('pagebreak test passed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
