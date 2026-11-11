// A held change, decided where it lands (the owner, 31 Oct 2026): one band on the sheet of an item a change held for the
// person would touch, saying who asked and why in a line, with Apply and Decline; Look opens the whole change, where
// parts can be left out or corrected. A change that only makes a new item has no item yet: its own sheet shows the item
// proposed, read-only, under the same band (`heldPage`).

import { api, h, hooks, may, part } from './base.js';
import { proposalCard } from './held-card.js';
import { decide } from './held.js';
import { renderBody } from './body.js';
import { ago, typeMark, gist, who } from './words.js';

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
  // Deciding is writing: a session that may only read sees the change, not the way to decide it.
  const buttons = !may('write') ? [] : [
    h('button', { class: 'primary', title: p.held_by?.say ?? 'Apply the change as it was asked', onclick: () => go(true) }, 'Apply'),
    h('button', { class: 'danger', title: 'Decline it, with a word for whoever asked', onclick: () => go(false) }, 'Decline'),
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
  // A thing to act on, with room around it (Alex, 11 Nov 2026): what it is, why it was asked, and the two buttons, with
  // its parts and who asked after them. Each is one line, cut where it does not fit.
  const by = who(p.actor, p.run_name);
  by.classList.add('cut');
  by.title = [p.run_name, who(p.actor).textContent, ago(p.ts)].filter(Boolean).join(' · ');
  const parts = p.ops.length > 1;
  return h(
    'section',
    { class: 'held-band', 'data-held': p.id },
    h('div', { class: 'held-head' }, 'Waits for your word'),
    h('div', { class: 'held-why cut', title: p.reason }, gist(p.reason)),
    h(
      'div',
      { class: 'held-acts' },
      ...buttons,
      parts && h('button', { type: 'button', class: 'quiet-button', title: 'See each part, and leave out or correct any before applying', onclick: look }, `${p.ops.length} parts ▾`),
      h('span', { class: 'grow' }),
      by,
    ),
    whole,
  );
}

// ---- The call over the canvas: while no sheet is open, what waits for the person's word is said above find, one press
// from the band that decides it (Alex, 11 Nov 2026). What is held is told by the store (ui/live.js).

const call = h('div', { class: 'held-call', hidden: true });
document.getElementById('find')?.prepend(call);
hooks.heldMoved = (held) => {
  const waiting = may('write') ? held : [];
  call.hidden = !waiting.length;
  if (call.hidden) return call.replaceChildren();
  const [first] = waiting;
  const n = waiting.length;
  call.replaceChildren(
    h('span', { class: 'held-call-n' }, n === 1 ? 'Waits for your word' : `${n} wait for your word`),
    h('span', { class: 'grow cut', title: first.reason }, gist(first.reason)),
    h('button', { type: 'button', class: 'primary', title: n === 1 ? 'Open it where it is decided' : 'Open the oldest where it is decided', onclick: () => (location.hash = heldAt(first)) }, 'Review'),
  );
};

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
        h('div', { class: 'page-head' }, h('h1', { class: 'grow', title: o.title }, o.title), typeMark(o.type)),
        o.body && h('div', {}, renderBody(o.body)),
      ),
    ),
  );
}
