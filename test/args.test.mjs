import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const merv = path.join(__dirname, '..', 'merv.js');
const sample = path.join(__dirname, 'fixtures', 'sample.md');

function run(...args) {
  const result = spawnSync(process.execPath, [merv, ...args], { encoding: 'utf8' });
  return { status: result.status, out: result.stdout + result.stderr };
}

// A flag missing its value must be rejected before anything is built; it used to
// reach vivliostyle as the literal string "undefined" and fail after the wait.
for (const flag of ['-T', '--theme', '-o', '--output']) {
  const result = run(sample, flag);
  assert.equal(result.status, 1, `${flag} without a value should exit 1`);
  assert.match(result.out, /requires a value/, `${flag} without a value should say so`);
}

// A mistyped flag used to be taken as the input filename. "-" is in the list
// because merv cannot read standard input: mermaid-cli is given a path.
for (const flag of ['--thme', '-x', '-']) {
  const result = run(flag, 'value', sample);
  assert.equal(result.status, 1, `${flag} should exit 1`);
  assert.match(result.out, /Unknown option/, `${flag} should be reported as unknown`);
}

// merv renders one file, so a stray second one is a mistake worth naming rather
// than a document to silently ignore.
const twoInputs = run(sample, sample);
assert.equal(twoInputs.status, 1, 'a second input should exit 1');
assert.match(twoInputs.out, /Unexpected argument/, 'a second input should be reported');

const help = run('-h');
assert.equal(help.status, 0, '-h should exit 0');
assert.match(help.out, /Usage: merv/, '-h should print usage');

// The version is read from a package.json found relative to merv.js, which the
// bin symlink and the "files" field both have a say in.
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const version = run('-v');
assert.equal(version.status, 0, '-v should exit 0');
assert.equal(version.out.trim(), pkg.version, '-v should print the package version');

// --keep-work-dir has to keep the directory even when a build fails, since
// that is when its contents are wanted. A missing input fails in mermaid-cli
// before any browser starts.
const kept = run('--keep-work-dir', path.join(__dirname, 'fixtures', 'missing.md'));
assert.notEqual(kept.status, 0, 'a missing input should fail');
const keptDir = kept.out.match(/work directory kept at (\S+)/)?.[1];
assert.ok(keptDir, `--keep-work-dir should print the directory: ${kept.out}`);
try {
  assert.ok(fs.existsSync(keptDir), '--keep-work-dir should leave the directory in place');
} finally {
  fs.rmSync(keptDir, { recursive: true, force: true });
}

const noArgs = run();
assert.equal(noArgs.status, 1, 'no arguments should exit 1');
assert.match(noArgs.out, /Usage: merv/, 'no arguments should print usage');

console.log('args test passed');
