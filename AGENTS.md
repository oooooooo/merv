# Merv

`merv` is a single-file ESM CLI (`merv.js`) that runs `mmdc` and then
`vivliostyle build` as child processes. Everything except the tests lives in
that one file. See README.md for what the tool does; this file is only for
what is not obvious from reading the code.

## Tests

Run `npm test`. The script globs `"test/*.test.mjs"` deliberately — a bare
`node --test test/` fails with MODULE_NOT_FOUND here.

Each test file is a plain top-level script, not a suite of `test()` blocks: it
asserts, prints `<name> test passed`, and cleans up in a `finally`. Follow that
shape. Files named `*.mjs` without `.test` (`test/pdf.mjs`) are helpers and are
not picked up by the glob.

Most of the suite's runtime is real PDF builds at roughly 4s each, so add one
only when a unit assertion genuinely cannot show the same thing — and make it
assert an *effect*. A build that merely exits 0 proves almost nothing: dropped
arguments and unrendered images both still exit 0.

There are no poppler tools in this environment. Read PDFs through
`test/pdf.mjs` (`readPdf`, `pageCount`, `pageWidth`, `imageSizes`). Note that
object dictionaries sit in the file uncompressed while the page tree is inside
a compressed object stream, which is why `readPdf` returns both.

## Invariants that look like cruft but are not

Each of these was a bug once. Confirm you understand the failure before
undoing any of them.

- **The page break CSS travels inside the document** as a `<style>` appended by
  `prepareMarkdown`, not via vivliostyle's `--css`. `--css` holds a single
  value, so a `merv.json` passing its own would silently replace the rules.
  It is appended, never prepended, so YAML frontmatter stays on line 1.
- **The `:has(> .merv-pagebreak)` rule** exists for themes that lay a section
  out as a fixed-height flex box (theme-slide): a break inside one is never
  taken. Test any page break change against theme-slide, not just the default.
- **Each run gets its own `mkdtemp` workdir, and the theme cache is staged into
  it and swapped back by rename.** vivliostyle reinstalls `<cwd>/themes` on
  every build, so a shared directory makes concurrent runs race. Cleanup hangs
  off `process.on('exit')` because `runTool` calls `process.exit`.
- **Config tokens are appended after merv's own arguments** so they win where
  the child tool lets the last occurrence win.
- **Local stylesheets are copied into the workdir, not just made absolute.**
  vivliostyle serves the document from a server rooted at its cwd and answers
  404 for anything outside, so an absolute path to a CSS theme builds with the
  theme silently missing.
- **`@vivliostyle/vfm` is a direct dependency pinned to the version
  `@vivliostyle/cli` pins.** merv asks it what is code so that it agrees with
  the renderer; `test/deps.test.mjs` fails when a CLI bump leaves them apart.
- **`npm-shrinkwrap.json` is a hand-kept copy of `package-lock.json`, and
  releases are published with npm 11.** The `overrides` that pin patched
  transitive dependencies only apply in this repository; users get them
  through the shrinkwrap. npm 12 neither writes the file nor packs it, so
  after any dependency change run `cp package-lock.json npm-shrinkwrap.json`
  (`test/deps.test.mjs` fails until you do).
- **Publish from a fresh clone, with npm 11:**

  ```sh
  git clone . /tmp/merv-release && cd /tmp/merv-release
  npm ci && npm test && npx npm@11 publish
  ```

  npm packs any `README.*` whatever `files` or `.npmignore` say, so the
  gitignored `README.pdf` a local `merv README.md` leaves behind would ship
  from a working copy. Where npm is set to `ignore-scripts`, as on the
  maintainer's machine, `prepublishOnly` does not run, hence the explicit
  `npm test`.
- **`bin` is `merv.js`, not `./merv.js`.** npm strips a `./` target while
  publishing, which would ship a package with no command.

## Conventions

- Chat in Japanese; code, comments, docs and commit messages in English.
- Commits follow the repo's `conventional-commits` skill: the body must say
  *why*, and asking beats guessing.
- Comments explain why, not what — see the `code-comments` skill.
- Run `markdownlint` on any Markdown you touch.
- `git diff` here opens an external side-by-side viewer; use
  `git --no-pager diff --no-ext-diff` for output you need to read. `git add -p`
  is unavailable, and `du` is aliased to `dust`.
