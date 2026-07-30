#!/usr/bin/env node
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const USAGE = `Usage: merv [-T theme] input.md

Options:
  -T, --theme   Vivliostyle theme (default: @vivliostyle/theme-techbook)
  -h, --help    Show this help

Themes:
  @vivliostyle/theme-techbook
  @vivliostyle/theme-academic
  @vivliostyle/theme-bunko
  @vivliostyle/theme-slide
  @vivliostyle/theme-gutenberg
`;

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
  throw new Error(`Cannot find installed package "${pkgName}"`);
}

function runTool(pkgName, binName, args) {
  const binPath = resolveBin(pkgName, binName);
  const result = spawnSync(process.execPath, [binPath, ...args], { stdio: 'inherit' });
  if (result.error) {
    console.error(`Failed to launch ${binName}: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function parseArgs(argv) {
  let theme = '@vivliostyle/theme-techbook';
  let input;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-T' || arg === '--theme') {
      i++;
      theme = argv[i];
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

  return { theme, input };
}

function main() {
  const { theme, input } = parseArgs(process.argv.slice(2));

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
  const pdf = path.resolve(base + '.pdf');
  const outMd = path.join(workdir, 'out.md');

  runTool('@mermaid-js/mermaid-cli', 'mmdc', ['-i', input, '-o', outMd, '-a', workdir]);
  runTool('@vivliostyle/cli', 'vivliostyle', ['build', outMd, '-s', 'A4', '-T', theme, '-o', pdf]);
}

main();
