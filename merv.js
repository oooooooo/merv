#!/usr/bin/env node
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USAGE = `Usage: merv [-T theme] [-o output.pdf] [--keep-work-dir] input.md
       merv -v | --version
       merv -h | --help

Options:
  -T, --theme       Vivliostyle theme (default: @vivliostyle/theme-techbook)
  -o, --output      Output PDF path (default: <input>.pdf)
  --keep-work-dir   Keep the intermediate files and print where they are
  -v, --version     Show version
  -h, --help        Show this help

Themes:
  https://docs.vivliostyle.org/en/themes/gallery/

Markup:
  <!-- pagebreak -->   Start a new page here

Config, named merv.json or .merv.json (first one found wins):
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

function runTool(pkgName, binName, args, cwd) {
  const binPath = resolveBin(pkgName, binName);
  const result = spawnSync(process.execPath, [binPath, ...args], { stdio: 'inherit', cwd });
  if (result.error) {
    console.error(`Failed to launch ${binName}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function resolveAsset(ref, srcDir, workdir) {
  const candidates = [ref];
  try {
    candidates.push(decodeURIComponent(ref));
  } catch {}
  for (const candidate of candidates) {
    // mermaid-cli writes the diagrams it extracted next to the intermediate
    // markdown, so those references already resolve and must be left alone.
    if (fs.existsSync(path.resolve(workdir, candidate))) return null;
    const abs = path.resolve(srcDir, candidate);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  }
  return null;
}

// Rework the markdown mermaid-cli produced into something vivliostyle can render
// from the workdir: copy in the assets it still points at outside, and turn the
// page break markers into elements vivliostyle breaks on.
export function prepareMarkdown(mdPath, srcDir, workdir) {
  const assetsDir = path.join(workdir, '_assets');
  const copies = new Map();

  const rewrite = (ref) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('//') || ref.startsWith('#')) return ref;
    if (copies.has(ref)) return copies.get(ref);
    const abs = resolveAsset(ref, srcDir, workdir);
    if (!abs) return ref;
    // Flatten and sanitize: the copy has to sit under the workdir with a name
    // that needs no URL escaping, whatever the source path looked like.
    const name = `${copies.size}-${path.basename(abs).replace(/[^\w.-]/g, '_')}`;
    fs.mkdirSync(assetsDir, { recursive: true });
    fs.copyFileSync(abs, path.join(assetsDir, name));
    const newRef = `_assets/${name}`;
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
}

// `![alt](dest)`, allowing one level of brackets in the alt text.
const INLINE_IMAGE = /(!\[(?:[^[\]]|\[[^\]]*\])*\]\(\s*)(<[^>]*>|[^()\s]*)/g;
const REFERENCE_DEFINITION = /^(\s{0,3}\[[^\]]+\]:\s*)(<[^>]*>|\S+)/;
const HTML_SRC = /(<img\b[^>]*?\bsrc\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/gi;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CODE_SPAN = /(`+[^`]*`+)/;
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
// links it relative to it.
const DIAGRAM_REF = /!\[[^\]]*\]\(\.\/out-\d+\.\w+\)/;
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
  // dropped. Frontmatter is not content: it renders to nothing.
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

  const lines = md.split('\n');
  let frontmatterEnd = -1;
  if (lines[0] === '---') {
    const close = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)$/.test(line));
    if (close > 0) frontmatterEnd = close;
  }

  let fence = null;
  return lines
    .map((line, lineIndex) => {
      if (lineIndex <= frontmatterEnd) return line;
      // Code is quoted markdown, not markup: rewriting it would corrupt a
      // document that happens to be about writing markdown.
      const fenceMatch = line.match(FENCE);
      if (fence) {
        if (fenceMatch && fenceMatch[1].startsWith(fence)) fence = null;
        return line;
      }
      if (fenceMatch) {
        fence = fenceMatch[1];
        pageHasContent = true;
        return line;
      }
      return line
        .split(CODE_SPAN)
        .map((part, i) => {
          if (i % 2 === 1) {
            pageHasContent = true;
            return part;
          }
          const rewritten = breakPages(part)
            .replace(INLINE_IMAGE, (_, head, dest) => head + swap(dest))
            .replace(HTML_SRC, (_, head, dest) => head + swapAttribute(dest));
          // A definition is only one if it opens the line, and only the first
          // part of the split still knows where the line began.
          return i === 0
            ? rewritten.replace(REFERENCE_DEFINITION, (_, head, dest) => head + swap(dest))
            : rewritten;
        })
        .join('');
    })
    .join('\n');
}

const CONFIG_NAMES = ['merv.json', '.merv.json'];
const CONFIG_KEYS = ['mermaid', 'vivliostyle'];

// Tokens to hand the child tools, from the nearest merv.json. The first file
// found wins outright: merging four of them would make the arguments a build
// actually ran with impossible to read off any single file.
export function loadConfig(cwd, srcDir) {
  const xdg = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  const candidates = [cwd, srcDir, path.join(xdg, 'merv'), os.homedir()].flatMap((dir) =>
    CONFIG_NAMES.map((name) => path.join(dir, name))
  );

  const found = candidates.find((candidate) => fs.existsSync(candidate));
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

function parseArgs(argv) {
  let theme = '@vivliostyle/theme-techbook';
  let output;
  let input;
  let keepWorkDir = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) {
        console.error(`Option "${arg}" requires a value`);
        process.exit(1);
      }
      return next;
    };
    if (arg === '-T' || arg === '--theme') {
      theme = value();
    } else if (arg === '-o' || arg === '--output') {
      output = value();
    } else if (arg === '--keep-work-dir') {
      keepWorkDir = true;
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

  return { theme, output, input, keepWorkDir };
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
  const { theme, output, input, keepWorkDir } = parseArgs(process.argv.slice(2));
  const srcDir = path.dirname(path.resolve(input));

  let config;
  try {
    config = loadConfig(process.cwd(), srcDir);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

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
    input,
    '-o',
    outMd,
    '-a',
    workdir,
    ...config.mermaid,
  ]);
  prepareMarkdown(outMd, srcDir, workdir);
  // Run from workdir: vivliostyle auto-loads vivliostyle.config.* from its cwd,
  // and such a config would override the entry/output we pass on the command line.
  runTool(
    '@vivliostyle/cli',
    'vivliostyle',
    ['build', outMd, '-s', 'A4', '-T', theme, '-o', builtPdf, ...config.vivliostyle],
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
if (entry === __filename) main();
