# merv-cli

Render a Markdown file containing Mermaid diagrams into a themed PDF, using
[`@mermaid-js/mermaid-cli`](https://github.com/mermaid-js/mermaid-cli) to
rasterize the diagrams and [`@vivliostyle/cli`](https://github.com/vivliostyle/vivliostyle-cli)
to typeset the result.

[Marp](https://marp.app/) is a fine way to get a deck out of Markdown, but it
wants a `---` at every slide boundary; `merv` lays the document out on its own.

The name is `mer`maid + `v`ivliostyle.

## Usage

```sh
npx merv-cli input.md
```

No install step required — `npx` fetches `merv-cli` and its two dependencies
on demand. Output is written next to the input as `input.pdf`.

### Options

```text
Usage: merv [-T theme] [-o output.pdf] input.md
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

Config, named merv.json or .merv.json (first one found wins):
  ./
  <input's directory>/
  $XDG_CONFIG_HOME/merv/
  $HOME/

  {"mermaid": ["-t", "dark"], "vivliostyle": ["--press-ready"]}
```

`mermaid-cli` and `vivliostyle` output is streamed through as-is.

### Page breaks

Write `<!-- pagebreak -->` to start a new page there:

```md
The end of one page.

<!-- pagebreak -->

The start of the next.
```

The marker is matched case-insensitively, works with any theme, and is
ignored inside code blocks and code spans.

## Configuration

Options `merv` does not have of its own are reached through a `merv.json`,
which passes arguments straight to the two tools underneath:

```json
{
  "mermaid": ["-t", "dark", "-b", "transparent"],
  "vivliostyle": ["--press-ready", "-s", "B5"]
}
```

Both keys are optional. `merv` looks for the file in the current directory,
then next to the input file, then in `$XDG_CONFIG_HOME/merv/` (falling back to
`~/.config/merv/`), then in `$HOME`. Either name works in any of them —
`merv.json`, or `.merv.json` to keep it out of a directory listing. **The first
file found is the only one used** — the others are ignored rather than merged.
A file that is not a JSON object, holds an unknown key, or holds anything but
arrays of strings fails the run instead of being ignored.

The arguments are appended after the ones `merv` passes itself, so where the
underlying tool lets the last occurrence win, the config wins — including over
`-T` given on the command line.

Note that a `merv.json` decides the arguments of the browser-driving tools
`merv` runs, so treat one that came with a cloned repository the way you would
treat any other executable content in it.

## Requirements

Node.js **>= 22.12.0** (required transitively by `@vivliostyle/cli`).

## Cache directory

Each run builds in its own directory under `$XDG_CACHE_HOME/merv` (falling
back to `~/.cache/merv`) and removes it when it exits, so concurrent runs
stay out of each other's way. Installed Vivliostyle themes are kept in
`themes/` next to it and reused, so only the first run pays for the install.
