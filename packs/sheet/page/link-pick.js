// Linking from an item's page (the owner, 10 Nov 2026: a link is started by a button, not dragged on the plane): Link on
// its page starts it, and the next item clicked on the canvas is the other end. The person picks what the link says,
// from the ways that fit (packs/walls/page/layout-asks.js), and it is sent as theirs. Escape, or Link again, lets it go. While it
// waits the page says so on <body> (`data-linking`), for the stylesheet to mark the canvas and the button.

import { api, tell } from './base.js';
import { askWay, itemOf, waysBetween } from './layout-asks.js';

let picking = null;

/** Start linking `from` (an item as its page holds it); `done(linked)` is called once it is made, held or let go. */
export function startLink(from, done = () => {}) {
  if (picking) return picking.stop();
  const canvas = document.getElementById('canvas');
  // Caught before the canvas hears it: a click on an item there is the other end, not a way to its page.
  const click = (ev) => {
    const mark = ev.target.closest?.('[data-item]');
    if (!mark || !canvas?.contains(mark) || mark.closest('.lf-island-add')) return;
    ev.preventDefault();
    ev.stopPropagation();
    const to = mark.dataset.item;
    if (to === from.id) return;
    stop(true);
    linkTo(from, to).then(done);
  };
  // Escape lets the link go, and only that: the sheet stays open.
  const key = (ev) => ev.key === 'Escape' && (ev.preventDefault(), ev.stopPropagation(), stop());
  const stop = (going = false) => {
    removeEventListener('click', click, true);
    removeEventListener('keydown', key, true);
    delete document.body.dataset.linking;
    picking = null;
    if (!going) done(false);
  };
  addEventListener('click', click, true);
  addEventListener('keydown', key, true);
  document.body.dataset.linking = from.id;
  picking = { stop };
}

/** Put a link from `from` to the item `to` to the person, and send it. Answers whether it was made or held. */
async function linkTo(from, to) {
  const other = await itemOf(to);
  if (!other) return (await tell('Not linked', 'That item could not be read.'), false);
  const ways = waysBetween(from, other);
  if (!ways.length) return (await tell('Not linked', `Nothing links ${from.title} and ${other.title}.`), false);
  const way = await askWay(from, other, ways);
  if (way === null) return false;
  try {
    const made = await api('change', { ops: [{ op: 'link', type: ways[way].type, from: ways[way].from, to: ways[way].to }], reason: 'Linked in the UI' });
    if (made.status && made.status !== 'applied') await tell('Held for approval', made.held_by?.say ?? 'A rule holds this change for a person to approve before it applies.');
    return true;
  } catch (err) {
    await tell('Not linked', err.message);
    return false;
  }
}
