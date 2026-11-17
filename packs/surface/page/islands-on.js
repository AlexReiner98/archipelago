// What a person has on their canvas: islands by id and live reads by name (decision e_n42s8jvn, the owner, 17 Nov 2026).
// It is kept on the map, on their person item (core's field `islands`), so it is their Home on any device; where the
// page knows no person (a server with sign-in off), it is kept in this browser. Toggling one is a change on their own
// authority, through the one write path. An address may carry another list (`#/v?islands=a,b`, an agent's show): that
// list is drawn and the person's own is left as it was.

import { api, whoami } from './base.js';

/** The live reads a person may toggle on beside islands, by the name the list keeps. */
export const READS = ['frontier', 'attention'];
/** What the list may hold: an island's id or a live read's name. */
const entry = (v) => typeof v === 'string' && (/^e_[a-z0-9]{8}$/.test(v) || READS.includes(v));
const clean = (v) => (Array.isArray(v) ? [...new Set(v.filter(entry))] : []);

const LOCAL = 'pelago-islands';
let person;
let list;
const heard = new Set();
const told = () => heard.forEach((f) => f(list));

/** The person the page acts as, if the server says (none with sign-in off). */
const me = () => (person ??= whoami().then((w) => w?.actor?.person ?? null, () => null));

/** The person's list, read once a page; the same promise after. */
let reading;
export function islandsOn() {
  reading ??= (async () => {
    const id = await me();
    if (id) list = clean((await api('get', { id }).catch(() => null))?.entity?.props?.islands);
    else {
      try {
        list = clean(JSON.parse(localStorage.getItem(LOCAL) ?? '[]'));
      } catch {
        list = [];
      }
    }
    return list;
  })();
  return reading;
}

/** Hear the list each time it changes; answers how to stop. */
export const onIslands = (f) => (heard.add(f), () => heard.delete(f));

/** Keep a new list: on the person item where there is one, else in this browser. Told at once; put back if refused. */
async function keep(next, reason) {
  const was = list;
  list = next;
  told();
  const id = await me();
  try {
    if (id) await api('change', { ops: [{ op: 'update', id, props: { islands: next } }], reason });
    else localStorage.setItem(LOCAL, JSON.stringify(next));
  } catch (err) {
    list = was;
    told();
    throw err;
  }
}

/** Put an island or a live read on the canvas, or take it off. */
export async function toggle(what, title = what) {
  await islandsOn();
  if (!entry(what)) return;
  const on = list.includes(what);
  await keep(on ? list.filter((x) => x !== what) : [...list, what], `${title} ${on ? 'taken off' : 'put on'} the canvas`);
}

/** The islands and reads an address names (`islands=a,b`), or null when it names none. */
export const islandsIn = (query) => {
  const named = new URLSearchParams(query ?? '').get('islands');
  return named === null ? null : clean(named.split(','));
};

/** Where each island stands on every canvas (its focus's field `corner`), by id: null where no agent has set one. */
export const corners = {};
/** Read the corners of these islands not read yet. */
export async function cornersOf(ids) {
  const missing = ids.filter((id) => /^e_/.test(id) && !(id in corners));
  const got = await Promise.all(missing.map((id) => api('get', { id }).catch(() => null)));
  missing.forEach((id, k) => (corners[id] = got[k]?.entity?.props?.corner ?? null));
  return corners;
}
