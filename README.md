# Merv

Markdown with Mermaid → themed PDF, via
[`@mermaid-js/mermaid-cli`](https://github.com/mermaid-js/mermaid-cli) and
[`@vivliostyle/cli`](https://github.com/vivliostyle/vivliostyle-cli).

No [Marp](https://marp.app/)-style `---` slide markers — layout is automatic. For a manual page break, write `<!-- pagebreak -->`.

`merv` = `mer`maid + `v`ivliostyle.

## Usage

```sh
npx @noooooooode/merv input.md && open input.pdf
```

Or

```sh
npm install -g @noooooooode/merv
merv input.md && open input.pdf
```

Needs Node.js **>= 22.12.0**, the floor `@vivliostyle/cli` sets.

Both tools underneath draw pages with a headless Chrome, which Puppeteer
downloads on install into `~/.cache/puppeteer` — around 650 MB, and the reason
the first run is a slow one. It is shared between projects and reused after
that.

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
  https://docs.vivliostyle.org/en/themes/gallery/

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

Options `merv` does not have of its own are reached through a `merv.json` or
`.merv.json`, which passes arguments straight to the two tools underneath:

```json
{
  "mermaid": ["-t", "dark", "-b", "transparent"],
  "vivliostyle": ["--press-ready", "-s", "B5"]
}
```

Both keys are optional. Filenames and search order:

1. Current directory
2. Directory of the input file
3. `$XDG_CONFIG_HOME/merv/` (fallback: `~/.config/merv/`)
4. `$HOME`

- **First match wins** — later files are ignored, not merged.
- Config args are appended after `merv`'s own, so where the last occurrence
  wins, the config wins — including over `-T` on the command line.

Treat a `merv.json` from a cloned repository like any other executable
content: it sets arguments for the browser-driving tools `merv` runs.

## License

[MIT](LICENSE)
