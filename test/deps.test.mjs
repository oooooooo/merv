import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

// merv finds code with VFM so that it agrees with the renderer about what is
// code. That only holds while both use the same VFM, so bumping
// @vivliostyle/cli means bumping @vivliostyle/vfm to the version it pins.
const ours = read('package.json').dependencies['@vivliostyle/vfm'];
const theirs = read('node_modules/@vivliostyle/cli/package.json').dependencies['@vivliostyle/vfm'];
assert.equal(ours, theirs, `@vivliostyle/vfm is ${ours}, but @vivliostyle/cli renders with ${theirs}`);

console.log('deps test passed');
