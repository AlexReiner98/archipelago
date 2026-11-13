# Panes

The panes of the page and the bar of tabs across them, and the plumbing that
lands an agent's show among them. A root pack: its code changes only through
a root re-pin, never by the refiner.

## Now: host code
Since 13 Nov 2026 (task e_d5ewsvgf) its modules are the host's, in `page/`,
served by name as every root's page files are. They hold a canvas in each
pane, drags, the page's address and history, and tabs kept across popped-out
windows, none of which a part's marks can say yet. So the pack declares no
`parts`: a part half declared would not load.

| Module | What it does |
|---|---|
| `panes.js` | The panes of the tab in sight: each a canvas at an address, its history, focus |
| `pane-drag.js` | Docking a pane by its name, and the lines between panes |
| `pane-address.js` | The browser's back and forward, as a step of the pane in focus |
| `tabs.js` | The tabs kept for each workspace, and the pure reads of them |
| `tab-bar.js` | The strip of tabs, its menu, popping out and docking back |
| `pane-route.js` | Where an agent's step lands among the tabs |
| `pane-land.js` | Landing it there |
| `pane-busy.js` | Whether the reader is at work in a pane, so a show waits |
| `pane-web.js` | A web page framed in a pane |
| `tab-life.js` | A chat's tab over its life |

## Later: one part
Once the slot contract has a mark that holds a canvas, drag gestures and the
address in the runtime, these become one part, `panes.panes`. It fills `tabs`
and opens `panes`, so one model holds the tabs and their panes
(`parts/model.js`, the strip's marks in `parts/strip.js`). It publishes
`lands_in`, `popped`, `front` and `address` as page state for the host to
read. Each piece waiting on a mark is a task under e_5fndpcsp.

A mark on one tab is the slot `tab.mark`, filled by sessions' count. What
each slot hands a part is in `docs/packs.md`.
