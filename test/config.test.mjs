import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig, locateConfig } from '../merv.js';
import { pageWidth } from './pdf.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const merv = path.join(__dirname, '..', 'merv.js');
const sample = path.join(__dirname, 'fixtures', 'sample.md');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merv-config-'));

const dirs = { cwd: 'cwd', src: 'src', xdg: 'xdg/merv', home: 'home' };
for (const rel of Object.values(dirs)) fs.mkdirSync(path.join(tmp, rel), { recursive: true });

const at = (key, name = 'merv.json') => path.join(tmp, dirs[key], name);
const write = (key, contents, name) =>
  fs.writeFileSync(at(key, name), typeof contents === 'string' ? contents : JSON.stringify(contents));
const load = () => loadConfig(path.join(tmp, dirs.cwd), path.join(tmp, dirs.src));

const env = { ...process.env };
process.env.XDG_CONFIG_HOME = path.join(tmp, 'xdg');
process.env.HOME = path.join(tmp, dirs.home);

try {
  // Nothing anywhere is not an error: merv's own arguments are the whole story.
  assert.deepEqual(load(), { mermaid: [], vivliostyle: [] });

  // A dotfile is the same config under a name that hides in a listing, and is
  // looked for in every location the plain name is.
  write('home', { mermaid: ['home-dot'] }, '.merv.json');
  assert.deepEqual(load().mermaid, ['home-dot'], '$HOME/.merv.json should be found');

  // The lookup stops at the first file it finds, so each location in turn is
  // shadowed by the one above it.
  write('home', { mermaid: ['home'] });
  assert.deepEqual(load().mermaid, ['home'], 'the plain name should win within a directory');
  write('xdg', { mermaid: ['xdg'] });
  assert.deepEqual(load().mermaid, ['xdg'], 'XDG_CONFIG_HOME should shadow $HOME');
  write('src', { mermaid: ['src'] }, '.merv.json');
  assert.deepEqual(
    load().mermaid,
    ['src'],
    "a dotfile in the markdown's directory should shadow XDG_CONFIG_HOME"
  );
  write('cwd', { mermaid: ['cwd'] });
  assert.deepEqual(load().mermaid, ['cwd'], "the cwd should shadow the markdown's directory");

  // Shadowing is total: a key the winner omits is not filled in from below.
  assert.deepEqual(load().vivliostyle, [], 'the losing files should not be merged in');

  write('cwd', { mermaid: ['-t', 'dark'], vivliostyle: ['--press-ready'] });
  assert.deepEqual(load(), { mermaid: ['-t', 'dark'], vivliostyle: ['--press-ready'] });

  // --config replaces the search outright, and --no-config skips it.
  const chosen = path.join(tmp, 'chosen.json');
  fs.writeFileSync(chosen, JSON.stringify({ mermaid: ['chosen'] }));
  assert.deepEqual(
    loadConfig(path.join(tmp, dirs.cwd), path.join(tmp, dirs.src), { file: chosen }).mermaid,
    ['chosen'],
    '--config should win over every searched location'
  );
  assert.equal(locateConfig(path.join(tmp, dirs.cwd), path.join(tmp, dirs.src), { none: true }), null);
  assert.deepEqual(loadConfig(path.join(tmp, dirs.cwd), path.join(tmp, dirs.src), { none: true }), {
    mermaid: [],
    vivliostyle: [],
  });
  // A named file that is not there must not fall back to the search, which
  // would build with a config the user did not ask for.
  assert.throws(
    () => loadConfig(path.join(tmp, dirs.cwd), path.join(tmp, dirs.src), { file: 'nope.json' }),
    /config file not found/
  );

  // A config that cannot be honoured has to say so: silently ignoring it would
  // produce a PDF that quietly disagrees with the file on disk.
  for (const [label, contents] of [
    ['a mistyped key', { mmdc: ['-t', 'dark'] }],
    ['a string value', { mermaid: '-t dark' }],
    ['a non-string token', { mermaid: [1] }],
    ['a non-object root', ['-t', 'dark']],
    ['malformed JSON', '{'],
  ]) {
    write('cwd', contents);
    assert.throws(load, (err) => err.message.includes(at('cwd')), `${label} should be rejected`);
  }

  // ...and the message has to reach the user as a message, not a stack trace.
  const rejected = spawnSync(process.execPath, [merv, sample], {
    cwd: path.join(tmp, dirs.cwd),
    encoding: 'utf8',
    // The real environment, so the child shares the theme cache: it finds its
    // config in the cwd, the first candidate, whatever $HOME says.
    env,
  });
  assert.equal(rejected.status, 1, 'a rejected config should exit 1');
  assert.doesNotMatch(rejected.stderr, /at \w+ \(/, 'a rejected config should not print a stack');

  // End to end, by an effect the PDF can be measured for rather than by a build
  // that merely survives: tokens silently dropped would exit 0 all the same.
  const pdf = path.join(tmp, 'out.pdf');
  const build = () =>
    spawnSync(process.execPath, [merv, sample, '-o', pdf], {
      cwd: path.join(tmp, dirs.cwd),
      encoding: 'utf8',
      // The real environment, so the child shares the theme cache: it finds its
      // config in the cwd, the first candidate, whatever $HOME says.
      env,
    });

  // merv asks for A4, so a page narrower than that is the config's -s winning.
  // vivliostyle takes each -o as one more output, so the config's adds a PDF
  // rather than replacing merv's; relative, it is resolved against the cwd
  // instead of landing in the workdir and being deleted with it.
  write('cwd', { vivliostyle: ['-s', 'B5', '-o', 'from-config.pdf'] });
  assert.equal(build().status, 0, 'a config build should exit 0');
  const fromConfig = path.join(tmp, dirs.cwd, 'from-config.pdf');
  assert.ok(fs.existsSync(pdf), "merv's own output should still be written");
  assert.ok(fs.existsSync(fromConfig), "the config's -o should add an output next to the cwd");
  const width = pageWidth(pdf);
  assert.ok(width < 560, `the vivliostyle tokens should reach vivliostyle (page is ${width}pt wide)`);

  // mermaid-cli has no comparable effect to measure, so prove arrival by an
  // argument it has to reject.
  write('cwd', { mermaid: ['--no-such-option'] });
  assert.notEqual(build().status, 0, 'the mermaid tokens should reach mermaid-cli');

  console.log('config test passed');
} finally {
  for (const key of ['XDG_CONFIG_HOME', 'HOME']) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  fs.rmSync(tmp, { recursive: true, force: true });
}
