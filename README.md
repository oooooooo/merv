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

```text
Usage: merv [-T theme] [-o output.pdf] [--verbose] input.md
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

Markup:
  <!-- pagebreak -->   Start a new page here
```

By default, `merv` only prints something if `mermaid-cli` or `vivliostyle`
fail (in which case their output is shown to help diagnose the error). Pass
`--verbose` to always stream their normal output.

### Page breaks

Write `<!-- pagebreak -->` to start a new page there:

```md
The end of one page.

<!-- pagebreak -->

The start of the next.
```

The marker is matched case-insensitively, works with any theme, and is
ignored inside code blocks and code spans.

## Requirements

Node.js **>= 22.12.0** (required transitively by `@vivliostyle/cli`).

## Cache directory

Each run builds in its own directory under `$XDG_CACHE_HOME/merv` (falling
back to `~/.cache/merv`) and removes it when it exits, so concurrent runs
stay out of each other's way. Installed Vivliostyle themes are kept in
`themes/` next to it and reused, so only the first run pays for the install.
