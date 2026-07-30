# merv-cli

Render a Markdown file containing Mermaid diagrams into a themed PDF, using
[`@mermaid-js/mermaid-cli`](https://github.com/mermaid-js/mermaid-cli) to
rasterize the diagrams and [`@vivliostyle/cli`](https://github.com/vivliostyle/vivliostyle-cli)
to typeset the result.

## Usage

```sh
npx merv-cli input.md
```

No install step required — `npx` fetches `merv-cli` and its two dependencies
on demand. Output is written next to the input as `input.pdf`.

### Options

```
Usage: merv [-T theme] input.md

Options:
  -T, --theme   Vivliostyle theme (default: @vivliostyle/theme-techbook)
  -h, --help    Show this help

Themes:
  @vivliostyle/theme-techbook
  @vivliostyle/theme-academic
  @vivliostyle/theme-bunko
  @vivliostyle/theme-slide
  @vivliostyle/theme-gutenberg
```

## Requirements

Node.js **>= 22.12.0** (required transitively by `@vivliostyle/cli`).

## Cache directory

Intermediate build output is kept in a persistent cache directory
(`$XDG_CACHE_HOME/merv/work`, falling back to `~/.cache/merv/work`) so that
Vivliostyle themes don't get reinstalled on every run. This directory is
wiped (except the `themes` subfolder) at the start of each invocation.
