import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

// A mistyped flag used to be taken as the input filename.
for (const flag of ['--thme', '-x']) {
  const result = run(flag, 'value', sample);
  assert.equal(result.status, 1, `${flag} should exit 1`);
  assert.match(result.out, /Unknown option/, `${flag} should be reported as unknown`);
}

// A filename is still a filename even when it follows a valid flag.
const help = run('-h');
assert.equal(help.status, 0, '-h should exit 0');
assert.match(help.out, /Usage: merv/, '-h should print usage');

const noArgs = run();
assert.equal(noArgs.status, 1, 'no arguments should exit 1');
assert.match(noArgs.out, /Usage: merv/, 'no arguments should print usage');

console.log('args test passed');
