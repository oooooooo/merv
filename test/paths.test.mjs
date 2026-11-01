import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvePathArgs } from '../merv.js';
import { pageCount } from './pdf.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const merv = path.join(__dirname, '..', 'merv.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merv-paths-'));

try {
  const workdir = path.join(tmp, 'work');
  fs.mkdirSync(workdir);
  fs.writeFileSync(path.join(tmp, 'a.css'), 'a');
  fs.writeFileSync(path.join(tmp, 'b.css'), 'b');
  fs.writeFileSync(path.join(tmp, 'browser'), '');
  fs.mkdirSync(path.join(tmp, 'dir-theme'));
  const resolve = (tokens) => resolvePathArgs(tokens, tmp, workdir);
  const inWorkdir = (p, contents) =>
    p.startsWith(workdir + path.sep) && fs.readFileSync(p, 'utf8') === contents;

  // A stylesheet is copied into the workdir, since vivliostyle's server is
  // rooted there; -T takes several values.
  const served = resolve(['-T', './a.css', 'b.css', '--style', 'a.css', '--user-style=./b.css']);
  assert.equal(served[0], '-T');
  assert.ok(inWorkdir(served[1], 'a') && inWorkdir(served[2], 'b'), `-T files should be copied: ${served}`);
  assert.ok(inWorkdir(served[4], 'a'), `--style should be copied: ${served}`);
  assert.match(served[5], /^--user-style=/);
  assert.ok(inWorkdir(served[5].slice('--user-style='.length), 'b'), `--user-style= should be copied: ${served}`);

  // A directory theme vivliostyle installs itself, and a file it opens rather
  // than serves, only need to be found from the workdir.
  assert.deepEqual(
    resolve(['-T', './dir-theme', '--executable-browser', 'browser']),
    ['-T', path.join(tmp, 'dir-theme'), '--executable-browser', path.join(tmp, 'browser')]
  );

  // The same options take package names and URLs, which must pass as written,
  // and a value for any other option is not a path at all.
  assert.deepEqual(
    resolve(['-T', '@vivliostyle/theme-slide', '--style', 'https://example.com/a.css', '--title', 'a.css']),
    ['-T', '@vivliostyle/theme-slide', '--style', 'https://example.com/a.css', '--title', 'a.css']
  );
  assert.equal(resolve(['--style', 'a.css', 'a.css'])[2], 'a.css', '--style takes one value only');

  // A config's -o names a file still to be written, so it is resolved even
  // though nothing is there yet; -f after it is left alone.
  assert.deepEqual(resolve(['-o', 'extra.pdf', '-f', 'pdf', '--output=web']), [
    '-o',
    path.join(tmp, 'extra.pdf'),
    '-f',
    'pdf',
    `--output=${path.join(tmp, 'web')}`,
  ]);

  // End to end: vivliostyle runs from the workdir, where "./theme.css" used to
  // name nothing and the build stopped with "Could not determine the package
  // name" -- and an absolute path built fine with the theme silently missing,
  // its server answering 404. The theme starts every heading on a new page, so
  // the page count shows it applied, which the exit status could not.
  fs.writeFileSync(path.join(tmp, 'theme.css'), 'h1 { break-before: page; }\n');
  fs.writeFileSync(path.join(tmp, 'doc.md'), 'intro\n\n# one\n\n# two\n');
  const result = spawnSync(process.execPath, [merv, 'doc.md', '-T', './theme.css', '-o', 'doc.pdf'], {
    cwd: tmp,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `a relative theme should build: ${result.stdout}${result.stderr}`);
  assert.equal(pageCount(path.join(tmp, 'doc.pdf')), 3, 'the relative theme should be applied');

  console.log('paths test passed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
