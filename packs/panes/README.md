# Panes

The panes of the page and the bar of tabs across them. A root pack: its parts
change only through a root re-pin, never by the refiner.

Its parts, to be declared here with their code (task e_d5ewsvgf):

| Part | Slot | From |
|---|---|---|
| `panes.panes` | `panes` | `ui/panes.js`, `ui/pane-drag.js`, `ui/pane-address.js` |
| `panes.tabs` | `tabs` | `ui/tabs.js`, `ui/tab-bar.js` |

Where agents land among the panes is presence's, and a mark on one tab is the
slot `tab.mark`. What each slot hands a part is in `docs/packs.md`.
