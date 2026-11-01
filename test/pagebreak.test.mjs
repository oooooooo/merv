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
const fixture = path.join(__dirname, 'fixtures', 'pagebreak.md');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merv-pagebreak-'));

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
      'a',
      '<!-- pagebreak -->',
      'b',
      '<!--pagebreak-->',
      'c',
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
    [1, 'canonical'],
    [3, 'unspaced'],
    [5, 'mixed case'],
    [6, 'inline'],
  ]) {
    assert.match(lines[i], /merv-pagebreak/, `the ${label} marker should become a break`);
    assert.doesNotMatch(lines[i], /<!--/, `the ${label} marker should be consumed`);
  }
  assert.equal(lines[7], '<!-- not a pagebreak -->', 'other comments should be left alone');
  assert.equal(lines[9], '<!-- pagebreak -->', 'fenced markers should be left alone');

  // A break with nothing before it on its page only adds a blank page: at the
  // top of the document, after frontmatter, or straight after another break.
  const breaksIn = (source) => {
    const p = path.join(workdir, 'collapse.md');
    fs.writeFileSync(p, source);
    prepareMarkdown(p, tmp, workdir);
    return fs.readFileSync(p, 'utf8').split('<style>')[0].match(/merv-pagebreak/g)?.length ?? 0;
  };
  assert.equal(breaksIn('<!-- pagebreak -->\n\n# a\n'), 0, 'a leading break should be dropped');
  assert.equal(
    breaksIn('---\ntitle: t\n---\n\n<!-- pagebreak -->\n\n# a\n'),
    0,
    'a break right after frontmatter should be dropped'
  );
  assert.equal(
    breaksIn('a\n\n<!-- pagebreak -->\n\n<!-- pagebreak --><!-- pagebreak -->\n\nb\n'),
    1,
    'consecutive breaks should collapse into one'
  );
  assert.equal(breaksIn('a\n\n```\nx\n```\n\n<!-- pagebreak -->\n\nb\n'), 1, 'code is content');
  assert.equal(breaksIn('a\n\n<!-- pagebreak -->\n\n`x`\n\n<!-- pagebreak -->\n\nb\n'), 2, 'a code span is content');

  // The rules travel in the document rather than on vivliostyle's --css, which
  // holds a single value a config could otherwise replace.
  const broken = fs.readFileSync(mdPath, 'utf8');
  assert.match(broken, /<style>[\s\S]*merv-pagebreak[\s\S]*<\/style>\s*$/, 'the CSS should be appended');

  // A document without a marker has nothing to style.
  const plainPath = path.join(workdir, 'plain.md');
  fs.writeFileSync(plainPath, '# plain\n');
  prepareMarkdown(plainPath, tmp, workdir);
  assert.equal(fs.readFileSync(plainPath, 'utf8'), '# plain\n', 'an unbroken document should be untouched');

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
