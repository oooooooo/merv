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

  // Persist workspace so vivliostyle does not reinstall themes every run.
  // (themes are installed under <workdir>/themes.)
  const workdir = path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'merv', 'work');
  fs.mkdirSync(workdir, { recursive: true });
  for (const entry of fs.readdirSync(workdir)) {
    if (entry !== 'themes') {
      fs.rmSync(path.join(workdir, entry), { recursive: true, force: true });
    }
  }

  const base = input.endsWith('.md') ? input.slice(0, -3) : input;
  const pdf = output ? path.resolve(output) : path.resolve(base + '.pdf');
  const outMd = path.join(workdir, 'out.md');

  runTool('@mermaid-js/mermaid-cli', 'mmdc', ['-i', input, '-o', outMd, '-a', workdir], verbose);
  // Run from workdir: vivliostyle auto-loads vivliostyle.config.* from its cwd,
  // and such a config would override the entry/output we pass on the command line.
  runTool('@vivliostyle/cli', 'vivliostyle', ['build', outMd, '-s', 'A4', '-T', theme, '-o', pdf], verbose, workdir);
}

main();
