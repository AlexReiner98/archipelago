// A held change, decided where it lands (the owner, 31 Oct 2026): one band on the sheet of an item a change held for the
// person would touch, saying who asked and why in a line, with Apply and Decline; Look opens the whole change, where
// parts can be left out or corrected. A change that only makes a new item has no item yet: its own sheet shows the item
// proposed, read-only, under the same band (`heldPage`).

import { api, h, part } from './base.js';
import { proposalCard } from './held-card.js';
import { decide } from './held.js';
import { renderBody } from './body.js';
import { ago, chip, gist, who } from './words.js';

const ITEM = /^e_[a-z0-9]{8}$/;
/** The ids an op names, as written. */
const namedBy = ({ id, keep, drop, from, to }) => [id, keep, drop, from, to].filter((x) => typeof x === 'string');

/** The held changes, as this person may see them, that touch `id`. */
export async function heldOn(id) {
  return (await api('proposals').catch(() => [])).filter((p) => p.ops.some((o) => namedBy(o).includes(id)));
}

/** The sheet a held change is decided on: the first item it touches, else its own page. */
export const heldAt = (p) => {
  const id = p.ops.flatMap(namedBy).find((x) => ITEM.test(x));
  return id ? `#/e/${id}` : `#/held/${p.id}`;
};

/** The names of the items a change touches, for the words of its parts. */
async function namesOf(p) {
  const ids = [...new Set(p.ops.flatMap(namedBy).filter((x) => ITEM.test(x)))].slice(0, 12);
  const got = await Promise.all(ids.map((id) => api('get', { id }).then((r) => r.entity, () => null)));
  return new Map(got.filter(Boolean).map((e) => [e.id, e]));
}

/** One change as a band: a line, and its parts unfolded by Look. `again` draws the page again once it is decided. */
export async function heldBand(p, again) {
  const names = await namesOf(p);
  const whole = h('div', { hidden: true });
  const buttons = [
    h('button', { class: 'primary', style: 'flex: none', title: p.held_by?.say ?? 'Apply the change as it was asked', onclick: () => go(true) }, 'Apply'),
    h('button', { class: 'danger', style: 'flex: none', title: 'Decline it, with a word for whoever asked', onclick: () => go(false) }, 'Decline'),
  ];
  const go = async (yes) => {
    for (const b of buttons) b.disabled = true;
    if (await decide(p, yes)) return again();
    for (const b of buttons) b.disabled = false;
  };
  const look = () => {
    whole.hidden = !whole.hidden;
    if (!whole.hidden && !whole.childElementCount) whole.append(proposalCard(p, names, again));
  };
  return h(
    'section',
    { class: 'held-band needs', 'data-held': p.id },
    h(
      'div',
      { class: 'row-top', style: 'flex-wrap: nowrap' },
      h('span', { class: 'muted small', style: 'flex: none' }, 'Held for you'),
      h('span', { class: 'grow', title: p.reason, style: 'min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis' }, gist(p.reason)),
      h('span', { class: 'muted small', style: 'flex: none' }, who(p.actor, p.run_name)),
      h('span', { class: 'muted small nowrap', style: 'flex: none' }, ago(p.ts)),
      p.ops.length > 1 && h('button', { class: 'quiet-button', style: 'flex: none', title: 'See each part of it, and leave out or correct any before applying', onclick: look }, `Look (${p.ops.length})`),
      ...buttons,
    ),
    whole,
  );
}

/** The sheet of a change that makes new items: what is proposed, read-only, under its band. */
export async function heldPage(proposal) {
  const page = part('item');
  const p = (await api('proposals').catch(() => [])).find((x) => x.id === proposal);
  if (!p) return page.replaceChildren(h('div', { class: 'empty' }, 'That change is decided, or it was never held for you. ', h('a', { href: '#/' }, 'Back to the map')));
  const made = p.ops.filter((o) => o.op === 'create');
  page.replaceChildren(
    await heldBand(p, () => heldPage(proposal)),
    ...made.map((o) =>
      h(
        'section',
        { class: 'page-section ghost-item' },
        h('div', { class: 'page-head' }, h('h1', { class: 'grow', title: o.title }, o.title), chip(o.type)),
        o.body && h('div', {}, renderBody(o.body)),
      ),
    ),
  );
}
