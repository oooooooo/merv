#!/usr/bin/env node
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USAGE = `Usage: merv [options] [--] input.md
       merv -v | --version
       merv -h | --help

Options:
  -T, --theme       Vivliostyle theme (default: @vivliostyle/theme-techbook)
  -o, --output      Output PDF path (default: <input>.pdf)
  --config <file>   Use this config instead of searching for one
  --no-config       Use no config
  --keep-work-dir   Keep the intermediate files and print where they are
  --verbose         Print the config used, and each tool's arguments and cwd
  -v, --version     Show version
  -h, --help        Show this help
  --                Take what follows as the input, even if it starts with -

Themes:
  https://docs.vivliostyle.org/en/themes/gallery/

Markup:
  <!-- pagebreak -->   Start a new page here

Config, named merv.json or .merv.json (first one found wins, unless --config):
  ./
  <input's directory>/
  $XDG_CONFIG_HOME/merv/
  $HOME/

  {"mermaid": ["-t", "dark"], "vivliostyle": ["--press-ready"]}
`;

function getVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  return pkg.version;
}

function resolveBin(pkgName, binName) {
  const req = createRequire(import.meta.url);
  for (const dir of req.resolve.paths(pkgName) ?? []) {
    const pkgJsonPath = path.join(dir, pkgName, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
      const rel = typeof pkgJson.bin === 'string' ? pkgJson.bin : pkgJson.bin?.[binName];
      if (!rel) throw new Error(`"${binName}" not found in ${pkgName}'s bin field`);
      return path.join(dir, pkgName, rel);
    }
  }
  throw new Error(
    `Cannot find installed package "${pkgName}". Run "npm install" in ${__dirname}.`
  );
}

let verbose = false;

function runTool(pkgName, binName, args, cwd = process.cwd()) {
  const binPath = resolveBin(pkgName, binName);
  // An array, not a shell line: a value with a space in it reads unambiguously.
  if (verbose) console.error(`merv: running ${binName} in ${cwd}: ${JSON.stringify(args)}`);
  const result = spawnSync(process.execPath, [binPath, ...args], { stdio: 'inherit', cwd });
  if (result.error) {
    console.error(`merv: failed to launch ${binName}: ${result.error.message}`);
    process.exit(1);
  }
  // The tool's own output streams past above, often at length; this line says
  // which of the two it came from and that it is the reason merv stopped.
  if (result.signal) {
    console.error(`merv: ${binName} was killed by ${result.signal}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`merv: ${binName} failed (exit ${result.status})`);
    process.exit(result.status);
  }
}

// Where a reference in the intermediate markdown points: 'workdir' when it
// already resolves there, the source file to copy in, or null when it resolves
// nowhere.
function resolveAsset(ref, srcDir, workdir) {
  const candidates = [ref];
  try {
    candidates.push(decodeURIComponent(ref));
  } catch {}
  for (const candidate of candidates) {
    // mermaid-cli writes the diagrams it extracted next to the intermediate
    // markdown, so those references already resolve and must be left alone.
    if (fs.existsSync(path.resolve(workdir, candidate))) return 'workdir';
    const abs = path.resolve(srcDir, candidate);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

// Rework the markdown mermaid-cli produced into something vivliostyle can render
// from the workdir: copy in the assets it still points at outside, and turn the
// page break markers into elements vivliostyle breaks on. Returns the local
// references that resolved nowhere.
export function prepareMarkdown(mdPath, srcDir, workdir) {
  const assetsDir = path.join(workdir, '_assets');
  const copies = new Map();
  const missing = new Set();

  const rewrite = (ref) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//') || ref.startsWith('#')) return ref;
    if (copies.has(ref)) return copies.get(ref);
    // "icon.svg#symbol" and "img.png?v=2" name the file before the suffix, and
    // the suffix still means something to the browser, so it rides along onto
    // the copy. The whole reference is tried first, for a file that really has
    // a "#" or "?" in its name.
    let abs = resolveAsset(ref, srcDir, workdir);
    let suffix = '';
    const split = ref.match(/^([^?#]+)([?#][\s\S]*)$/);
    if (abs === null && split) {
      abs = resolveAsset(split[1], srcDir, workdir);
      suffix = split[2];
    }
    if (abs === null) missing.add(ref);
    if (abs === null || abs === 'workdir') return ref;
    // Flatten and sanitize: the copy has to sit under the workdir with a name
    // that needs no URL escaping, whatever the source path looked like.
    const name = `${copies.size}-${path.basename(abs).replace(/[^\w.-]/g, '_')}`;
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.copyFileSync(abs, path.join(assetsDir, name));
    const newRef = `_assets/${name}${suffix}`;
    copies.set(ref, newRef);
    return newRef;
  };

  const md = transformMarkdown(fs.readFileSync(mdPath, 'utf8'), rewrite);
  // These rules travel in the document rather than on vivliostyle's --css,
  // which holds a single value a merv.json could otherwise replace.
  // Appended, not prepended, so YAML frontmatter stays on the first line.
  const rules = [];
  if (md.includes(PAGE_BREAK_HTML)) rules.push(PAGE_BREAK_CSS);
  if (DIAGRAM_REF.test(md)) rules.push(DIAGRAM_CSS);
  const style = rules.length ? `\n<style>\n${rules.join('\n')}\n</style>\n` : '';
  fs.writeFileSync(mdPath, md + style);
  return { missing: [...missing] };
}

// `![alt](dest)`, allowing one level of brackets in the alt text and one level
// of balanced parentheses in the destination, as in "chart(v2).png".
const INLINE_IMAGE = /(!\[(?:[^[\]]|\[[^\]]*\])*\]\(\s*)(<[^>]*>|(?:[^()\s]|\([^()\s]*\))*)/g;
const REFERENCE_DEFINITION = /^(\s{0,3}\[[^\]]+\]:\s*)(<[^>]*>|\S+)/;
const HTML_SRC = /(<img\b[^>]*?\bsrc\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/gi;
const PAGE_BREAK = /<!--\s*pagebreak\s*-->/gi;
const PAGE_BREAK_HTML = '<div class="merv-pagebreak"></div>';
// Written into the document so the break outranks the theme's own page rules.
// The :has() rule is for themes that lay a section out as a fixed height flex box
// (theme-slide does): a break inside one is never taken, so the container has to
// be turned back into ordinary block flow first.
const PAGE_BREAK_CSS = [
  '.merv-pagebreak { break-after: page !important; page-break-after: always !important; }',
  ':has(> .merv-pagebreak) { display: block !important; height: auto !important; }',
].join('\n');
// mermaid-cli names each diagram after the markdown it writes, out.md, and
// links it relative to it. Only the destination is matched: accDescr becomes
// the alt text and accTitle a title after it, and either can hold anything.
const DIAGRAM_REF = /\]\(\.\/out-\d+\.\w+(?=[\s)])/;
// A diagram is an image and cannot be split across pages, so a tall one ran on
// over two. Vivliostyle measures vh against the page area, so this fits it to
// whatever margins the theme sets. Block, so the line box holding an inline
// image adds no height; 95vh leaves room for the paragraph's own margins. Those
// are em, but vivliostyle ignored calc(100vh - 2.5em) when it was tried.
const DIAGRAM_CSS =
  'img[src^="./out-"] { display: block; margin: 0 auto; max-width: 100%; max-height: 95vh; }';

function transformMarkdown(md, rewrite) {
  // A rewritten name is plain ASCII with no spaces, so whatever delimiters the
  // source used around the destination are no longer needed -- except the
  // quotes in HTML, which are part of the attribute.
  const swap = (dest) => {
    const bare = dest.replace(/^<([^>]*)>$/, '$1');
    const next = rewrite(bare);
    return next === bare ? dest : next;
  };
  const swapAttribute = (dest) => {
    const quote = dest[0] === '"' || dest[0] === "'" ? dest[0] : '';
    const bare = quote ? dest.slice(1, -1) : dest;
    const next = rewrite(bare);
    return next === bare ? dest : `${quote}${next}${quote}`;
  };

  // A break with nothing on the page before it -- at the top of the document,
  // or right after another break -- would only produce a blank page, so it is
  // dropped.
  let pageHasContent = false;
  const breakPages = (text) =>
    text
      .split(PAGE_BREAK)
      .map((segment, i) => {
        const marker = i > 0 && pageHasContent ? PAGE_BREAK_HTML : '';
        if (marker) pageHasContent = false;
        if (/\S/.test(segment)) pageHasContent = true;
        return marker + segment;
      })
      .join('');

  const rewriteProse = (text, startsLine) =>
    text
      .split('\n')
      .map((line, i) => {
        const rewritten = breakPages(line)
          .replace(INLINE_IMAGE, (_, head, dest) => head + swap(dest))
          .replace(HTML_SRC, (_, head, dest) => head + swapAttribute(dest));
        // A definition is only one if it opens the line, which the first line
        // of a stretch that follows a code span does not.
        return i > 0 || startsLine
          ? rewritten.replace(REFERENCE_DEFINITION, (_, head, dest) => head + swap(dest))
          : rewritten;
      })
      .join('\n');

  let out = '';
  let at = 0;
  for (const { start, end, content } of verbatimRanges(md)) {
    out += rewriteProse(md.slice(at, start), at === 0 || md[at - 1] === '\n');
    out += md.slice(start, end);
    if (content) pageHasContent = true;
    at = end;
  }
  return out + rewriteProse(md.slice(at), at === 0 || md[at - 1] === '\n');
}

// The stretches of the document to copy through untouched. Code is quoted
// markdown, not markup: rewriting it would corrupt a document that happens to
// be about writing markdown. Frontmatter is data, and renders to nothing.
// Finding them is left to VFM, the parser vivliostyle itself renders with, since
// a hand-written scanner kept disagreeing with it -- over indented code, code
// spans across lines, and spans with backticks inside.
function verbatimRanges(md) {
  const { VFM } = createRequire(import.meta.url)('@vivliostyle/vfm');
  const ranges = [];
  const visit = (node) => {
    if (node.type === 'code' || node.type === 'inlineCode' || node.type === 'yaml') {
      const { start, end } = node.position;
      ranges.push({ start: start.offset, end: end.offset, content: node.type !== 'yaml' });
      return;
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(VFM().parse(md));
  return ranges.sort((a, b) => a.start - b.start);
}

const CONFIG_NAMES = ['merv.json', '.merv.json'];
const CONFIG_KEYS = ['mermaid', 'vivliostyle'];

// The config file a build uses, or null for none. The first file found wins
// outright: merging four of them would make the arguments a build actually ran
// with impossible to read off any single file. --config names the file instead
// of searching, and --no-config skips the search.
export function locateConfig(cwd, srcDir, { file, none = false } = {}) {
  if (none) return null;
  if (file !== undefined) {
    const abs = path.resolve(cwd, file);
    // Falling back to the search would build with a config the user did not ask for.
    if (!fs.existsSync(abs)) throw new Error(`${abs}: config file not found`);
    return abs;
  }
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const candidates = [cwd, srcDir, path.join(xdg, 'merv'), os.homedir()].flatMap((dir) =>
    CONFIG_NAMES.map((name) => path.join(dir, name))
  );
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

// Tokens to hand the child tools, from the config locateConfig picks.
export function loadConfig(cwd, srcDir, options) {
  const found = locateConfig(cwd, srcDir, options);
  if (!found) return Object.fromEntries(CONFIG_KEYS.map((key) => [key, []]));

  // A config that cannot be honoured has to be reported: quietly ignoring it
  // would produce a PDF that disagrees with the file on disk.
  const reject = (reason) => {
    throw new Error(`${found}: ${reason}`);
  };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(found, 'utf8'));
  } catch (err) {
    reject(err.message);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    reject('must hold a JSON object');
  }
  for (const key of Object.keys(parsed)) {
    if (!CONFIG_KEYS.includes(key)) reject(`unknown key "${key}" (expected ${CONFIG_KEYS.join(' or ')})`);
    if (!Array.isArray(parsed[key]) || parsed[key].some((token) => typeof token !== 'string')) {
      reject(`"${key}" must be an array of strings`);
    }
  }
  return Object.fromEntries(CONFIG_KEYS.map((key) => [key, parsed[key] ?? []]));
}

// merv's own options, so that one can be told apart from a value.
const OPTIONS = new Set([
  '-T',
  '--theme',
  '-o',
  '--output',
  '--config',
  '--no-config',
  '--keep-work-dir',
  '--verbose',
  '-v',
  '--version',
  '-h',
  '--help',
  '--',
]);

function parseArgs(argv) {
  let theme = '@vivliostyle/theme-techbook';
  let output;
  let input;
  let configFile;
  let noConfig = false;
  let keepWorkDir = false;
  let verbose = false;
  let positionalOnly = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    // "-T -o out.pdf" is a forgotten theme, not a theme named "-o": taking it
    // as one would also lose the output path the user did give.
    const value = () => {
      const next = argv[++i];
      if (next === undefined || next === '' || OPTIONS.has(next)) {
        console.error(`Option "${arg}" requires a value`);
        process.exit(1);
      }
      return next;
    };
    if (positionalOnly) {
      if (input !== undefined) {
        console.error(`Unexpected argument: ${arg}`);
        process.exit(1);
      }
      input = arg;
    } else if (arg === '--') {
      positionalOnly = true;
    } else if (arg === '-T' || arg === '--theme') {
      theme = value();
    } else if (arg === '-o' || arg === '--output') {
      output = value();
    } else if (arg === '--config') {
      configFile = value();
    } else if (arg === '--no-config') {
      noConfig = true;
    } else if (arg === '--keep-work-dir') {
      keepWorkDir = true;
    } else if (arg === '--verbose') {
      verbose = true;
    } else if (arg === '-v' || arg === '--version') {
      console.log(getVersion());
      process.exit(0);
    } else if (arg === '-h' || arg === '--help') {
      process.stdout.write(USAGE);
      process.exit(0);
    } else if (arg.startsWith('-')) {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    } else if (input !== undefined) {
      console.error(`Unexpected argument: ${arg}`);
      process.exit(1);
    } else {
      input = arg;
    }
  }

  if (!input) {
    process.stderr.write(USAGE);
    process.exit(1);
  }
  if (configFile !== undefined && noConfig) {
    console.error('Options "--config" and "--no-config" cannot be used together');
    process.exit(1);
  }

  return { theme, output, input, configFile, noConfig, keepWorkDir, verbose };
}

// The vivliostyle build options whose value names a file. -T takes several.
const PATH_OPTIONS = new Set([
  '-T',
  '--theme',
  '--style',
  '--user-style',
  '-c',
  '--config',
  '--executable-browser',
  '--vite-config-file',
]);
const MULTI_VALUE_OPTIONS = new Set(['-T', '--theme']);
// The ones whose file the browser loads from vivliostyle's server.
const SERVED_OPTIONS = new Set(['-T', '--theme', '--style', '--user-style']);
// Each -o in a config adds an output to the one merv asks for. It names a file
// still to be written, so it is resolved whether or not it exists; left
// relative, it would land in the workdir and be deleted with it.
const OUTPUT_OPTIONS = new Set(['-o', '--output']);

// Point the file values among vivliostyle tokens at something vivliostyle can
// use from the workdir it runs in. A relative path is resolved against baseDir,
// and only when it exists there: the same options take package names
// (-T @vivliostyle/theme-slide) and URLs (--style), which have to pass as
// written. A stylesheet file is copied into the workdir as well, because the
// server vivliostyle loads it through is rooted there and answers 404 for
// anything outside -- an absolute path is not enough. A directory theme is
// installed by vivliostyle itself, so its absolute path is.
export function resolvePathArgs(tokens, baseDir, workdir) {
  let copies = 0;
  const resolve = (option, value) => {
    const abs = path.resolve(baseDir, value);
    if (OUTPUT_OPTIONS.has(option)) return abs;
    if (!fs.existsSync(abs)) return value;
    if (!SERVED_OPTIONS.has(option) || !fs.statSync(abs).isFile()) return abs;
    const dir = path.join(workdir, '_styles');
    fs.mkdirSync(dir, { recursive: true });
    const copy = path.join(dir, `${copies++}-${path.basename(abs).replace(/[^\w.-]/g, '_')}`);
    fs.copyFileSync(abs, copy);
    return copy;
  };
  let option = null;
  return tokens.map((token) => {
    const joined = token.match(/^(--[\w-]+)=([\s\S]*)$/);
    if (joined) {
      option = null;
      return PATH_OPTIONS.has(joined[1]) || OUTPUT_OPTIONS.has(joined[1])
        ? `${joined[1]}=${resolve(joined[1], joined[2])}`
        : token;
    }
    if (token.startsWith('-')) {
      option = PATH_OPTIONS.has(token) || OUTPUT_OPTIONS.has(token) ? token : null;
      return token;
    }
    if (!option) return token;
    const current = option;
    if (!MULTI_VALUE_OPTIONS.has(option)) option = null;
    return resolve(current, token);
  });
}

// Move the PDF vivliostyle wrote in the workdir to where it was asked for. Up to
// here a failed build has left any earlier PDF at that path alone, and this
// keeps it that way: the copy lands next to the target and is renamed over it,
// so the target is the old file or the whole new one, never a partial write.
// The rename cannot start from the workdir, which may sit on another filesystem.
export function commitPdf(built, target) {
  let pdf;
  try {
    pdf = fs.readFileSync(built);
  } catch {
    throw new Error(`vivliostyle exited 0 but wrote no PDF at ${built}`);
  }
  // A truncated file still opens in some viewers, so check both ends rather
  // than trusting the exit status alone.
  const tail = pdf.subarray(-1024).toString('latin1');
  if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-')) || !/%%EOF\s*$/.test(tail)) {
    throw new Error(`vivliostyle exited 0 but ${built} is not a complete PDF`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.tmp`);
  try {
    fs.writeFileSync(temp, pdf);
    fs.renameSync(temp, target);
  } catch (err) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const { theme, input, keepWorkDir } = args;
  verbose = args.verbose;
  const srcDir = path.dirname(path.resolve(input));

  let config;
  try {
    const options = { file: args.configFile, none: args.noConfig };
    if (verbose) console.error(`merv: config: ${locateConfig(process.cwd(), srcDir, options) ?? 'none'}`);
    config = loadConfig(process.cwd(), srcDir, options);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const output = args.output;

  const cacheRoot = path.join(
    process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'),
    'merv'
  );
  // A workdir per run: two merv processes sharing one would overwrite each
  // other's intermediate markdown and each emit the other's document.
  fs.mkdirSync(cacheRoot, { recursive: true });
  const workdir = fs.mkdtempSync(path.join(cacheRoot, 'work-'));
  // runTool exits the process on failure, so clean up from the exit hook.
  process.on('exit', () => {
    if (keepWorkDir) console.error(`merv: work directory kept at ${workdir}`);
    else fs.rmSync(workdir, { recursive: true, force: true });
  });

  // vivliostyle reinstalls <cwd>/themes on every build, so the directory cannot
  // be shared live between runs -- two installs racing in it fail with ENOTEMPTY.
  // Seed a private copy from the cache instead, which leaves the install with
  // nothing to fetch, and publish it back below.
  const themes = path.join(cacheRoot, 'themes');
  const stagedThemes = path.join(workdir, 'themes');
  try {
    fs.cpSync(themes, stagedThemes, { recursive: true });
  } catch {
    // No cache yet, or another run was mid-publish: install from scratch.
  }

  const base = input.endsWith('.md') ? input.slice(0, -3) : input;
  const pdf = output ? path.resolve(output) : path.resolve(base + '.pdf');
  const outMd = path.join(workdir, 'out.md');
  const builtPdf = path.join(workdir, 'out.pdf');

  // Config tokens go last so they can override the arguments merv chose for the
  // options where the child tool lets the last occurrence win.
  runTool('@mermaid-js/mermaid-cli', 'mmdc', [
    '-i',
    // Absolute, so an input named "-x.md" (reachable after --) is not taken
    // for an option.
    path.resolve(input),
    '-o',
    outMd,
    '-a',
    workdir,
    ...config.mermaid,
  ]);
  // A missing image still builds, as Chrome's broken-image icon, so the exit
  // status alone would never tell the user.
  const { missing } = prepareMarkdown(outMd, srcDir, workdir);
  for (const ref of missing) console.error(`merv: referenced file not found: ${ref} (looked in ${srcDir})`);
  // Run from workdir: vivliostyle auto-loads vivliostyle.config.* from its cwd,
  // and such a config would override the entry/output we pass on the command line.
  // That same move would send a relative theme or stylesheet looking in the
  // workdir, so those are resolved first, against the directory mermaid-cli's
  // relative paths are already resolved against.
  runTool(
    '@vivliostyle/cli',
    'vivliostyle',
    [
      'build',
      outMd,
      '-s',
      'A4',
      '-o',
      builtPdf,
      ...resolvePathArgs(['-T', theme, ...config.vivliostyle], process.cwd(), workdir),
    ],
    workdir
  );
  try {
    commitPdf(builtPdf, pdf);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  // Swap the freshly installed themes in so the next run starts from them. The
  // gap where no cache exists is a rename apart, and a run that hits it just
  // installs from scratch.
  try {
    const replaced = `${themes}-replaced-${process.pid}`;
    if (fs.existsSync(themes)) fs.renameSync(themes, replaced);
    fs.renameSync(stagedThemes, themes);
    fs.rmSync(replaced, { recursive: true, force: true });
  } catch {
    // Losing the cache update only costs the next run an install.
  }
}

// Importing this file (the tests do) must not start a build. The bin entry is a
// symlink, so compare against what it resolves to.
const entry = process.argv[1] && fs.existsSync(process.argv[1]) ? fs.realpathSync(process.argv[1]) : '';
if (entry === __filename) {
  // An exception that escapes -- a missing dependency, an unwritable cache --
  // is reported as a message, not a stack trace.
  try {
    main();
  } catch (err) {
    console.error(`merv: ${err.message}`);
    process.exit(1);
  }
}
