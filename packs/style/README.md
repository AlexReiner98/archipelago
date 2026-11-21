# style

Page side: the look every view shares, as data (tokens.ts). Sets the
tokens of [spec/style.md](../../spec/style.md) as custom properties on the
page's root: colours by day and by night, type, space, and the glyphs of
the marks. Needs nothing and nothing needs it: unloaded, every view falls
back to the system's own colours and font, with plain marks.

- By day on the root, by night when the system is dark, and either scheme
  on any element with `data-scheme="light"` or `"dark"`.
- Tokens made of others (`mark-done` is `held`, `control` is `panel`) are
  set again wherever a scheme is, so they follow it.
- Fires `style:changed` on `document` when its sheet comes or goes; views
  that draw glyphs or a canvas re-read then.

`view.ts` is the pack `style-view`, the tab "Style": every token as the
page draws it now, day and night side by side.
