# style

The look every view shares: colours in light and dark, type, space and
the marks for states. Edition 6. Types and names: [style.ts](style.ts).

## Tokens, not a capability

A token is a CSS custom property on the page's root: `--fg`, `--text-s`,
`--glyph-circle-moving`. A style pack sets them; views only refer to them.
There is nothing to inject, so a view never waits for a style: with none
loaded each token is its plain value (`TOKENS`), the system's own colours
and font, and the page still reads.

- A view's sheet goes through `sheet(css)`, which gives every `var(--…)`
  of a token its plain fallback. In a style attribute, `v(name)` does the
  same.
- A view that draws without CSS (a canvas, a glyph in SVG text) reads a
  token with `read(name)`, and again on `onStyle`: the style pack fires
  `style:changed` on `document` when its tokens come or go.
- A view may read only the tokens named here, and keeps no colours of its
  own. A new token is a new edition.

## The tokens

| Group | Tokens |
|---|---|
| Page | `bg` `fg` `dim` `line` `panel` `lit` (linked to what is looked at) `pick` (picked, hovered) |
| Verdicts | `held` `failed` `quiet` |
| Items' marks | `mark-fresh` `mark-moving` `mark-done` `mark-gone` |
| Exchange | `say` `write` `fire` |
| Words' sources | `owner` `learned` `schema` `harness` (edition 9: what the harness gave the agent, not the map) |
| Packs | `hue-1` … `hue-6` |
| Controls | `control` `control-fg` `control-line` |
| Type | `font` `mono` `text-xs` `text-s` `text-m` `text` `text-l` `leading` `bold` |
| Space | `space-1` … `space-5` `radius` |
| Frame | `frame-left` `frame-right`: the widths of those regions (edition 7, [frame](frame.md)) |
| Glyphs | `glyph-<shape>-<side>`, `glyph-<verdict>` |

## Marks

An item's mark comes from its base and where its status sits, never its
type's name. Its shape is the base's place among the bases defined
(`SHAPES`: square, diamond, circle, triangle, then round again). Its side
is the status's place: the first open is `fresh`, a later open `moving`,
the first closed `done`, a later closed `gone`. The glyph is
`glyph-<shape>-<side>`, drawn in `mark-<side>`.

A node's verdict in a run is `held`, `failed`, `quiet`, or `none` when it
said nothing: glyph `glyph-<verdict>`, drawn in the verdict's colour.
