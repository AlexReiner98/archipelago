// The page's address and the browser's history, as the part on `tabs` sees them (task e_ucm3tppm): the runtime owns
// location and history, a walled part never touches them. The part is handed `page: { hash }`, again whenever the
// address changes, and is told `{ name: 'step', step: -1 | 1, hash }` when the person goes back or forth; it answers
// `go({ hash, push })`, which writes the address, a step of history when `push`, written over the entry when not.
// Each entry the page makes is stamped with where it stands in the history (`n`), so a step back or forth is known as
// one. Heard only once a part fills `tabs`: until then the page's own panes (ui/pane-address.js) do this.

/** How long an address a part names may be. */
const hashMost = 4000;

let heard = false;
/** Where the page stands in the browser's history: each entry it made is stamped `n`, in order. */
let seen = 0;
const stamp = (n) => history.replaceState({ ...(history.state ?? {}), n }, '');

/** A window popped out of the main one draws one tab: its key, from the window's name. */
const POPPED = 'pelago-tab:';
const popped = () => (window.name.startsWith(POPPED) ? window.name.slice(POPPED.length) : null);
/** The page as the part on `tabs` is handed it: its address, and in a popped window the tab it draws. */
export const pageOf = () => ({ hash: location.hash || '#/', ...(popped() && { popped: popped() }) });

/** The windows popped out from this page, by key. */
const windows = new Map();
const KEY = /^[A-Za-z0-9_-]{1,60}$/;
/** Open a tab in a window of its own, at an address of this page (the browser lets it only just after a press). */
export function openWindow({ key, hash }) {
  if (!KEY.test(String(key)) || typeof hash !== 'string' || !hash.startsWith('#/') || hash.length > hashMost) return;
  const win = open(`${location.pathname}${hash}`, `${POPPED}${key}`, `popup,width=${Math.round(innerWidth / 2)},height=${Math.round(innerHeight)}`);
  if (win) windows.set(String(key), win);
}
/** Bring a popped window forward, if this page opened it and it is still open. */
export function focusWindow({ key }) {
  const win = windows.get(String(key));
  if (win && !win.closed) win.focus();
}

/** Hear the history for the part on `tabs`, once: `tell(event)` tells it a step, `moved()` hands it the page again. */
export function hearPage(tell, moved) {
  if (heard) return;
  heard = true;
  seen = history.state?.n ?? 0;
  if (history.state?.n === undefined) stamp(seen);
  addEventListener('popstate', (ev) => {
    const n = ev.state?.n;
    // An entry made just now (the address written, a link followed): the next in order.
    if (n === undefined) return (stamp((seen += 1)), moved());
    const step = Math.sign(n - seen);
    seen = n;
    if (step) tell({ name: 'step', step, hash: location.hash || '#/' });
    moved();
  });
  addEventListener('hashchange', () => (history.state?.n === undefined && stamp((seen += 1)), moved()));
}

/** Write the address a part named: a hash of this page, pushed as a step of history or written over the entry. */
export function goHash({ hash, push } = {}) {
  if (typeof hash !== 'string' || !hash.startsWith('#/') || hash.length > hashMost || /[\s<>"]/.test(hash)) return false;
  if (location.hash === hash) return true;
  if (push) location.hash = hash;
  else history.replaceState(history.state, '', hash);
  return true;
}
