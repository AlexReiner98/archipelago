// How the pages drawing looks (index.js): each item a page on the sea, side by side, its text at a reader's measure.
// Every length and number here is the style's (sizes and numbers, read as --ln-*): the house style names them.

export const css = `
.pg-stage { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--ln-pages-gap); padding: var(--ln-pages-pad); background: var(--ln-sea); }
.pg-page { box-sizing: border-box; width: min(100%, var(--ln-pages-width)); padding: var(--ln-pages-page-pad-y) var(--ln-pages-page-pad-x); background: var(--ln-land); color: var(--ln-text); border: var(--ln-rule) solid var(--ln-line); border-radius: var(--ln-radius-size); font-family: var(--face-text); font-size: var(--ln-pages-text); line-height: var(--ln-pages-line); overflow-wrap: anywhere; }
.pg-page.here { outline: var(--ln-here-ring) solid var(--accent); outline-offset: var(--ln-here-ring); }
.pg-page a { color: var(--accent); text-decoration: none; }
.pg-page a:hover { text-decoration: underline; }
.pg-title { display: block; font-size: var(--ln-pages-title); font-weight: 700; line-height: 1.25; color: var(--ln-text) !important; }
.pg-meta { color: var(--ln-muted); font-size: var(--ln-small-text); margin: var(--ln-grid-card-gap) 0 var(--ln-pages-section-gap); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pg-page p, .pg-list, .pg-quote, .pg-pre, .pg-table { margin: 0 0 var(--ln-pages-block-gap); }
.pg-h { font-weight: 700; line-height: 1.3; margin: var(--ln-pages-section-gap) 0 var(--ln-pages-block-gap); }
.pg-h1 { font-size: var(--ln-pages-head-1); }
.pg-h2 { font-size: var(--ln-pages-head-2); }
.pg-h3 { font-size: var(--ln-pages-head-3); }
.pg-list { padding-left: var(--ln-pages-indent); }
.pg-list li.check { list-style: none; position: relative; }
.pg-box { position: absolute; left: calc(-1 * var(--ln-pages-indent)); color: var(--ln-muted); }
.pg-list li.check.done { color: var(--ln-muted); }
.pg-quote { padding-left: var(--ln-pages-indent); border-left: var(--ln-grid-stripe) solid var(--ln-line); color: var(--ln-muted); }
.pg-quote.warning, .pg-quote.caution { border-left-color: var(--ln-warn); }
.pg-quote.note, .pg-quote.tip { border-left-color: var(--accent); }
.pg-pre { white-space: pre-wrap; font-family: var(--face-code, monospace); font-size: var(--ln-small-text); padding: var(--ln-pages-block-gap); background: var(--ln-inner); border-radius: var(--ln-radius-size); }
.pg-code { font-family: var(--face-code, monospace); font-size: 0.9em; }
.pg-link { border-bottom: var(--ln-rule) dotted var(--ln-muted); }
.pg-table { display: table; width: 100%; border-collapse: collapse; font-size: var(--ln-small-text); }
.pg-row { display: table-row; }
.pg-row > span { display: table-cell; overflow-wrap: break-word; padding: var(--ln-grid-card-gap) var(--ln-pages-block-gap); border-bottom: var(--ln-rule) solid var(--ln-line); }
.pg-row.head > span { font-weight: 700; }
.pg-section { margin: var(--ln-pages-section-gap) 0; }
.pg-section > .pg-h a { color: var(--ln-text); }
.pg-section.closed > .pg-h a { color: var(--ln-muted); text-decoration: line-through; }
.pg-missing { color: var(--ln-muted); font-style: italic; margin: 0 0 var(--ln-pages-block-gap); }
.pg-empty { color: var(--ln-muted); font-style: italic; }
.pg-page.dim { opacity: var(--ln-dim); }
`;
