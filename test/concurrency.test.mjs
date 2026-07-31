import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const merv = path.join(__dirname, '..', 'merv.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merv-concurrency-'));

function build(input, output) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [merv, input, '-o', output], { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code));
  });
}

const first = path.join(tmp, 'first.pdf');
const second = path.join(tmp, 'second.pdf');

try {
  const codes = await Promise.all([
    build(path.join(__dirname, 'fixtures', 'sample.md'), first),
    build(path.join(__dirname, 'fixtures', 'second.md'), second),
  ]);

  assert.deepEqual(codes, [0, 0], 'both concurrent builds should exit 0');

  const firstSize = fs.statSync(first).size;
  const secondSize = fs.statSync(second).size;
  const ratio = Math.abs(firstSize - secondSize) / Math.max(firstSize, secondSize);
  // The fixtures render to visibly different documents, so near-equal sizes mean
  // one run rendered the other's markdown out of a shared workdir.
  assert.ok(
    ratio > 0.2,
    `concurrent builds produced near-identical PDFs (${firstSize} vs ${secondSize} bytes)`
  );

  console.log('concurrency test passed');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
