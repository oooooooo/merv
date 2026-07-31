#!/usr/bin/env node
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const USAGE = `Usage: merv [-T theme] [-o output.pdf] [--verbose] input.md
       merv -v | --version
       merv -h | --help

Options:
  -T, --theme     Vivliostyle theme (default: @vivliostyle/theme-techbook)
  -o, --output    Output PDF path (default: <input>.pdf)
  -v, --version   Show version
      --verbose   Show full output from mermaid-cli/vivliostyle
  -h, --help      Show this help

Themes:
  @vivliostyle/theme-techbook
  @vivliostyle/theme-academic
  @vivliostyle/theme-bunko
  @vivliostyle/theme-slide
  @vivliostyle/theme-gutenberg
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

function runTool(pkgName, binName, args, verbose, cwd) {
  const binPath = resolveBin(pkgName, binName);
  const stdio = verbose ? 'inherit' : ['ignore', 'pipe', 'pipe'];
  const result = spawnSync(process.execPath, [binPath, ...args], { stdio, cwd });
  if (result.error) {
    console.error(`Failed to launch ${binName}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    if (!verbose) {
      if (result.stdout?.length) process.stderr.write(result.stdout);
      if (result.stderr?.length) process.stderr.write(result.stderr);
    }
    process.exit(result.status ?? 1);
  }
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

// Vivliostyle renders the intermediate markdown from the cache workdir, so
// images the source referenced relative to its own directory fall outside the
// served root. Copy them in and repoint the references at the copies.
function copyLocalAssets(mdPath, srcDir, workdir) {
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

  const md = fs
    .readFileSync(mdPath, 'utf8')
    .replace(/(!\[[^\]]*\]\(\s*<?)([^>)\s]+)/g, (_, head, ref) => head + rewrite(ref))
    .replace(/(<img\b[^>]*?\bsrc\s*=\s*")([^"]+)/gi, (_, head, ref) => head + rewrite(ref));
  fs.writeFileSync(mdPath, md);
}

function parseArgs(argv) {
  let theme = '@vivliostyle/theme-techbook';
  let output;
  let verbose = false;
  let input;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-T' || arg === '--theme') {
      i++;
      theme = argv[i];
    } else if (arg === '-o' || arg === '--output') {
      i++;
      output = argv[i];
    } else if (arg === '--verbose') {
      verbose = true;
    } else if (arg === '-v' || arg === '--version') {
      console.log(getVersion());
      process.exit(0);
    } else if (arg === '-h' || arg === '--help') {
      process.stdout.write(USAGE);
      process.exit(0);
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

  return { theme, output, verbose, input };
}

function main() {
  const { theme, output, verbose, input } = parseArgs(process.argv.slice(2));

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

  runTool('@mermaid-js/mermaid-cli', 'mmdc', ['-i', input, '-o', outMd, '-a', workdir], verbose);
  copyLocalAssets(outMd, path.dirname(path.resolve(input)), workdir);
  // Run from workdir: vivliostyle auto-loads vivliostyle.config.* from its cwd,
  // and such a config would override the entry/output we pass on the command line.
  runTool('@vivliostyle/cli', 'vivliostyle', ['build', outMd, '-s', 'A4', '-T', theme, '-o', pdf], verbose, workdir);

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

main();
