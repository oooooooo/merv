import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkConfigOutputs, commitPdf, configOutputs, outputPath } from '../merv.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merv-output-'));
const at = (name) => path.join(tmp, name);
const pdf = '%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF\n';

try {
  // An earlier PDF at the target is what the user has until a new one is known
  // to be whole, so every rejected build has to leave it byte for byte.
  const target = at('doc.pdf');
  fs.writeFileSync(target, 'previous');
  for (const [label, contents] of [
    ['a missing PDF', null],
    ['an empty file', ''],
    ['a file without a PDF header', 'not a pdf %%EOF\n'],
    ['a truncated PDF', '%PDF-1.7\n1 0 obj\n<<'],
  ]) {
    const built = at('built.pdf');
    fs.rmSync(built, { force: true });
    if (contents !== null) fs.writeFileSync(built, contents);
    assert.throws(() => commitPdf(built, target), /vivliostyle exited 0/, `${label} should be rejected`);
    assert.equal(fs.readFileSync(target, 'utf8'), 'previous', `${label} should leave the old PDF`);
  }

  fs.writeFileSync(at('built.pdf'), pdf);
  commitPdf(at('built.pdf'), target);
  assert.equal(fs.readFileSync(target, 'utf8'), pdf, 'a complete PDF should replace the old one');
  assert.deepEqual(
    fs.readdirSync(tmp).filter((name) => name.endsWith('.tmp')),
    [],
    'the staging file should not be left behind'
  );

  // vivliostyle made missing parent directories when it wrote the target
  // itself, so commitPdf has to keep doing so.
  const nested = at('a/b/doc.pdf');
  commitPdf(at('built.pdf'), nested);
  assert.equal(fs.readFileSync(nested, 'utf8'), pdf, 'missing parent directories should be created');

  // A directory given to -o, written as one or already existing, gets a PDF
  // inside it named after the input.
  fs.mkdirSync(at('existing'));
  assert.equal(outputPath('dir/doc.md', at('existing')), at('existing/doc.pdf'));
  assert.equal(outputPath('dir/doc.md', `${at('new')}/`), at('new/doc.pdf'));
  assert.equal(outputPath('dir/doc.md', at('named.pdf')), at('named.pdf'));
  assert.equal(outputPath(at('doc.md')), at('doc.pdf'));

  // A config's -o tokens, in each of their spellings, resolved against the cwd.
  assert.deepEqual(configOutputs(['-o', 'a.pdf', '-f', 'pdf', '--output=web', '-s', 'B5'], tmp), [
    at('a.pdf'),
    at('web'),
  ]);

  // An extensionless -o is a webpub directory vivliostyle deletes before
  // writing, so one holding the project, the input or the cwd is refused; so is
  // one that would overwrite merv's own PDF before the build has succeeded.
  const project = at('project');
  const guard = { pdf: path.join(project, 'doc.pdf'), protect: [project, path.join(project, 'doc.md')] };
  for (const output of [project, tmp, path.dirname(tmp)]) {
    assert.throws(() => checkConfigOutputs([output], guard), /which it could delete/, `${output} should be refused`);
  }
  assert.throws(() => checkConfigOutputs([guard.pdf], guard), /merv's own output/);
  checkConfigOutputs([path.join(project, 'web'), at('other.pdf')], guard);

  console.log('output test passed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
