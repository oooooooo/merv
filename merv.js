#!/usr/bin/env node
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const USAGE = `Usage: merv [-T theme] [-o output.pdf] input.md
       merv -v | --version
       merv -h | --help

Options:
  -T, --theme     Vivliostyle theme (default: @vivliostyle/theme-techbook)
  -o, --output    Output PDF path (default: <input>.pdf)
  -v, --version   Show version
  -h, --help      Show this help

Themes:
  @vivliostyle/theme-techbook
  @vivliostyle/theme-academic
  @vivliostyle/theme-bunko
  @vivliostyle/theme-slide
  @vivliostyle/theme-gutenberg

Markup:
  <!-- pagebreak -->   Start a new page here
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

  fs.writeFileSync(mdPath, transformMarkdown(fs.readFileSync(mdPath, 'utf8'), rewrite));
}

// `![alt](dest)`, allowing one level of brackets in the alt text.
const INLINE_IMAGE = /(!\[(?:[^[\]]|\[[^\]]*\])*\]\(\s*)(<[^>]*>|[^()\s]*)/g;
const REFERENCE_DEFINITION = /^(\s{0,3}\[[^\]]+\]:\s*)(<[^>]*>|\S+)/;
const HTML_SRC = /(<img\b[^>]*?\bsrc\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/gi;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const CODE_SPAN = /(`+[^`]*`+)/;
const PAGE_BREAK = /<!--\s*pagebreak\s*-->/gi;
const PAGE_BREAK_HTML = '<div class="merv-pagebreak"></div>';
// Passed to vivliostyle so the break outranks the theme's own page rules. The
// :has() rule is for themes that lay a section out as a fixed height flex box
// (theme-slide does): a break inside one is never taken, so the container has to
// be turned back into ordinary block flow first.
const PAGE_BREAK_CSS = [
  '.merv-pagebreak { break-after: page !important; page-break-after: always !important; }',
  ':has(> .merv-pagebreak) { display: block !important; height: auto !important; }',
].join('\n');

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

  let fence = null;
  return md
    .split('\n')
    .map((line) => {
      // Code is quoted markdown, not markup: rewriting it would corrupt a
      // document that happens to be about writing markdown.
      const fenceMatch = line.match(FENCE);
      if (fence) {
        if (fenceMatch && fenceMatch[1].startsWith(fence)) fence = null;
        return line;
      }
      if (fenceMatch) {
        fence = fenceMatch[1];
        return line;
      }
      return line
        .split(CODE_SPAN)
        .map((part, i) => {
          if (i % 2 === 1) return part;
          const rewritten = part
            .replace(PAGE_BREAK, PAGE_BREAK_HTML)
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

function parseArgs(argv) {
  let theme = '@vivliostyle/theme-techbook';
  let output;
  let input;

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

  return { theme, output, input };
}

function main() {
  const { theme, output, input } = parseArgs(process.argv.slice(2));

  const cacheRoot = path.join(
    process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'),
    'merv'
  );
  // A workdir per run: two merv processes sharing one would overwrite each
  // other's intermediate markdown and each emit the other's document.
  fs.mkdirSync(cacheRoot, { recursive: true });
  const workdir = fs.mkdtempSync(path.join(cacheRoot, 'work-'));
  // runTool exits the process on failure, so clean up from the exit hook.
  process.on('exit', () => fs.rmSync(workdir, { recursive: true, force: true }));

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

  runTool('@mermaid-js/mermaid-cli', 'mmdc', ['-i', input, '-o', outMd, '-a', workdir]);
  prepareMarkdown(outMd, path.dirname(path.resolve(input)), workdir);
  // Run from workdir: vivliostyle auto-loads vivliostyle.config.* from its cwd,
  // and such a config would override the entry/output we pass on the command line.
  runTool(
    '@vivliostyle/cli',
    'vivliostyle',
    ['build', outMd, '-s', 'A4', '-T', theme, '-o', pdf, '--css', PAGE_BREAK_CSS],
    workdir
  );

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
