import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { commitPdf } from '../merv.js';

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

  console.log('output test passed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
