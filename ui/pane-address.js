// The browser's back and forward on the page. The address is the pane in focus's (ui/panes.js), and each step a pane
// takes there is an entry of the browser's history, stamped with where it stands in it, so a step back or forth through
// those entries is known as one. It is ‹ or › on the pane in focus, whichever pane took the step; an entry that only
// opens or shuts a page over the canvas does just that.

import { readFlatLens } from './lens.js';
import { activeId, hrefNow, travel } from './panes.js';
import { front } from './tabs.js';

/** What an address draws in a pane (`v`, `v?…`), or undefined where it names a page and no lens. */
export function atOf(hash) {
  const [where, query = ''] = (hash || '#/').split('?');
  const [, name = '', arg] = where.split('/');
  if (name === '') return 'v';
  if (name === 'v') return query ? `v?${query}` : 'v';
  if (name === 'e' && arg && readFlatLens(query).lens) return `v?${query}`;
  return undefined;
}

/** Where the page stands in the browser's history: each entry it made is stamped `n`, in order. */
let seen = history.state?.n ?? 0;
const stamp = (n) => history.replaceState({ ...(history.state ?? {}), n }, '');
if (history.state?.n === undefined) stamp(seen);
addEventListener('popstate', (ev) => {
  const n = ev.state?.n;
  // An entry made just now (the address written, a link followed): the next in order.
  if (n === undefined) return stamp((seen += 1));
  const by = Math.sign(n - seen);
  seen = n;
  const p = front()?.panes[activeId()];
  const at = atOf(location.hash);
  if (!by || !p || at === undefined || at === p.at) return;
  const hash = location.hash;
  // Nothing left that way in the pane: the address stays the pane's.
  if (!travel(by, hash)) history.replaceState(ev.state, '', hrefNow(hash));
});
addEventListener('hashchange', () => history.state?.n === undefined && stamp((seen += 1)));
