import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { FLAG_OPTIONS, VALUE_OPTIONS } from '../merv.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

// merv finds code with VFM so that it agrees with the renderer about what is
// code. That only holds while both use the same VFM, so bumping
// @vivliostyle/cli means bumping @vivliostyle/vfm to the version it pins.
const ours = read('package.json').dependencies['@vivliostyle/vfm'];
const theirs = read('node_modules/@vivliostyle/cli/package.json').dependencies['@vivliostyle/vfm'];
assert.equal(ours, theirs, `@vivliostyle/vfm is ${ours}, but @vivliostyle/cli renders with ${theirs}`);

// npm-shrinkwrap.json is what carries the overrides to users: npm ignores a
// dependency's overrides, but installs the tree its shrinkwrap records. npm 12
// no longer writes the file, so it is a copy of package-lock.json kept by hand,
// and a copy left behind would ship the tree from before the last update.
const lock = fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8');
const shrinkwrap = fs.readFileSync(path.join(root, 'npm-shrinkwrap.json'), 'utf8');
assert.equal(shrinkwrap, lock, 'npm-shrinkwrap.json is stale: cp package-lock.json npm-shrinkwrap.json');

// merv reads vivliostyle's options to find paths and outputs among a config's
// tokens, which only works while it knows every option that takes a value.
const help = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules/@vivliostyle/cli/dist/cli.js'), 'build', '--help'],
  { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } }
).stdout.replace(/\x1b\[[0-9;]*m/g, '');
const listed = [...help.matchAll(/^\s+(?:-\w, )?(--[\w-]+) <[^>]+>/gm)].map((m) => m[1]).sort();
assert.ok(listed.length > 0, 'could not read the options from vivliostyle build --help');
assert.deepEqual([...VALUE_OPTIONS].sort(), listed, 'VALUE_OPTIONS in merv.js is out of step with vivliostyle');
const flags = [...help.matchAll(/^\s+(?:-\w, )?(--[\w-]+)(?=\s{2,}|$)/gm)].map((m) => m[1]);
// --help is the one option merv leaves to commander; --sandbox is one vivliostyle hides.
const listedFlags = [...flags.filter((f) => f !== '--help'), '--sandbox'].sort();
assert.deepEqual([...FLAG_OPTIONS].sort(), listedFlags, 'FLAG_OPTIONS in merv.js is out of step with vivliostyle');

console.log('deps test passed');
