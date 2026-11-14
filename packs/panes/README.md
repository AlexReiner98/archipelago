# Panes

The tabs at the top of the page and the panes of the one in sight, and where
an agent's show lands among them. A root pack: its code changes only through
a root re-pin, never by the refiner.

## The part
`panes.panes` decides all of it (task e_d5ewsvgf, decision e_bn76z5fu). It
fills `tabs` and is mounted a second time for the panes, so one model holds
both, kept in the person's browser by workspace. The runtime draws its marks:
a `pane` for each canvas, `panes` laying them out, drags, tab looks.

| Module | What it decides |
|---|---|
| `parts/index.js` | The part: the page's address and steps, presses and drops, shows, chats ending, popped windows |
| `parts/model.js` | Tabs and panes as data: open, place, close, history, share, join, split off |
| `parts/strip.js` | The strip of tabs as marks, and each tab's menu |
| `parts/route.js` | Where a show lands |
| `parts/life.js` | A show landing, a chat ending or resting, a tab watching what it draws |

It publishes `front`, `front_chat`, `front_follows`, `lands_in` and
`pane_at` on the root, which the host reads.

## The host
What a part cannot do, in `page/`:

| Module | What it does |
|---|---|
| `panes.js` | Draws a pane's canvas at the address the part names, and tells it what is drawn there |
| `tab-bar.js` | Starts the part, gives the query bar back, forth and split, and counts the sessions waiting |
| `pane-busy.js` | Tells the part where the reader is at work, so a show passes them by |
| `pane-route.js` | The sessions heard and what each is called |
| `tabs.js` | The tab in sight, as the part publishes it |
| `pane-address.js`, `pane-land.js` | What app.js asks of the panes |
