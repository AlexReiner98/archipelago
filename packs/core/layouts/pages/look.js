// How the pages drawing looks (index.js): each document a row on the sea, its title over its draft, and with the
// style's `published` its published page beside it (or under it where the pane is narrow), each in a frame as tall as the page it holds.
// Every length and number here is the style's (sizes, read as --ln-*): the house style names them.

export const css = `
.pg-stage { display: flex; flex-direction: column; gap: var(--ln-pages-gap); padding: var(--ln-pages-pad); background: var(--ln-sea); }
.pg-row { display: flex; flex-direction: column; gap: var(--ln-pages-block-gap); }
.pg-row.here .pg-title { color: var(--accent); }
.pg-head { display: flex; align-items: baseline; gap: var(--ln-pages-block-gap); min-width: 0; white-space: nowrap; }
.pg-title { font-size: var(--ln-pages-title); font-weight: 700; color: var(--ln-text); text-decoration: none; overflow: hidden; text-overflow: ellipsis; }
.pg-title:hover { text-decoration: underline; }
.pg-meta { color: var(--ln-muted); font-size: var(--ln-small-text); overflow: hidden; text-overflow: ellipsis; }
.pg-pair { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--ln-pages-width)), 1fr)); gap: var(--ln-pages-gap); align-items: start; }
.rd { display: flex; flex-direction: column; gap: var(--ln-grid-card-gap); min-width: 0; }
.rd-state { color: var(--ln-muted); font-size: var(--ln-small-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rd.changed .rd-state { color: var(--ln-warn); }
.rd-slot { position: relative; border: var(--ln-rule) solid var(--ln-line); border-radius: var(--ln-radius-size); overflow: hidden; background: var(--ln-land); min-height: var(--ln-pages-least); }
.rd.none .rd-slot { display: none; }
.rd-slot iframe { display: block; width: 100%; height: var(--ln-pages-least); border: 0; }
.rd-slot iframe.rd-next { position: absolute; top: 0; left: 0; visibility: hidden; }
`;
