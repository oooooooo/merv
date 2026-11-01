import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { checkConfigOutputs, commitPdf, outputPath, vivliostyleOutputs } from '../merv.js';

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

  // The outputs vivliostyle will write, read by commander as vivliostyle reads
  // them, in every spelling and wherever its parse puts them.
  const outputs = (args) => vivliostyleOutputs(['in.md', ...args], tmp);
  assert.deepEqual(outputs(['-o', 'a.pdf', '-f', 'pdf', '--output=web', '-ob.pdf', '-s', 'B5']), [
    at('a.pdf'),
    at('web'),
    at('b.pdf'),
  ]);
  // An option takes the token after it even when that token looks like one.
  assert.deepEqual(outputs(['--title', '--output=.', '-T', 'a', 'b', '--author', '-o']), []);
  // Short flags run together, and the corners of commander's reading of them.
  assert.deepEqual(outputs(['-ml', '--title', '-o', 'p']), [at('p')], '-ml takes --title as -l');
  assert.deepEqual(outputs(['-mo', 'q', '-mlja', '-mpox.pdf']), [at('q'), at('x.pdf')]);
  assert.deepEqual(outputs(['-o/abs/project', '-o./extra.pdf', '-mo/x']), ['/abs/project', at('extra.pdf'), '/x']);
  assert.deepEqual(outputs(['-mm-output=/abs/project']), ['/abs/project'], 'a long option out of a cluster');
  // After "--" these are inputs, more than vivliostyle takes, so it would stop;
  // merv stops first.
  assert.throws(() => outputs(['--', '-o', 'r']), /too many arguments/);
  // What it cannot read is refused, not passed on unchecked.
  assert.throws(() => outputs(['--no-such-option', '-o', '.']), /could not read the vivliostyle arguments/);

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
