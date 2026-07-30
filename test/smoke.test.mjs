import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const input = path.join(__dirname, 'fixtures', 'sample.md');
const pdf = path.join(__dirname, 'fixtures', 'sample.pdf');

fs.rmSync(pdf, { force: true });

const result = spawnSync(process.execPath, [path.join(root, 'merv.js'), input], {
  stdio: 'inherit',
});

try {
  assert.equal(result.status, 0, 'merv.js should exit 0');
  assert.ok(fs.existsSync(pdf), 'expected PDF was not produced');
  assert.ok(fs.statSync(pdf).size > 0, 'produced PDF is empty');
  console.log('smoke test passed');
} finally {
  fs.rmSync(pdf, { force: true });
}
