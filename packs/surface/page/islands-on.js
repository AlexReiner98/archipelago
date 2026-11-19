// What a person has on their canvas: islands by id and live reads by name (decision e_n42s8jvn, the owner, 17 Nov 2026).
// It is kept on the map, on their person item (core's field `islands`), so it is their Home on any device; where the
// page knows no person (a server with sign-in off), it is kept in this browser. Toggling one is a change on their own
// authority, through the one write path. An address may carry another list (`#/v?islands=a,b`, an agent's show): that
// list is drawn and the person's own is left as it was.

import { api, whoami } from './base.js';
import { clean, islandsIn, listWith, READS, viewsIn } from './islands-list.js';

export { islandsIn, READS };

const LOCAL = 'pelago-islands';
let person;
let list;
/** The views kept on the same list (e_74ghhvdp): by a lens's id or a pack's view's. */
let views = [];
const heard = new Set();
const heardViews = new Set();
const told = () => (heard.forEach((f) => f(list)), heardViews.forEach((f) => f(views)));

/** The person the page acts as, if the server says (none with sign-in off). */
const me = () => (person ??= whoami().then((w) => w?.actor?.person ?? null, () => null));

/** The islands Home draws for a person who has chosen none yet: the map's, the latest first. */
const unchosen = () => api('search', { islands: true }).then((found) => clean(found.map((e) => e.id)), () => []);

/** The person's list, read once a page; each ask after it answers the list as it is now. */
let reading;
export function islandsOn() {
  reading ??= (async () => {
    const id = await me();
    let kept;
    if (id) kept = (await api('get', { id }).catch(() => null))?.entity?.props?.islands;
    else {
      try {
        kept = JSON.parse(localStorage.getItem(LOCAL) ?? 'null');
      } catch {
        kept = null;
      }
    }
    // A person who has never chosen sees the map's islands, the latest first (as many as search gives by default), so
    // the work agents left is drawn on their first look; their first toggle makes the list their own.
    list = kept == null ? await unchosen() : clean(kept);
    views = viewsIn(kept);
  })();
  // The list as it is now, not as first read: a toggle since then keeps a new one (Home drawn again read the old).
  return reading.then(() => list);
}

/** Hear the list each time it changes; answers how to stop. */
export const onIslands = (f) => (heard.add(f), () => heard.delete(f));
/** The views on the person's list, as it is now. */
export const viewsKept = () => islandsOn().then(() => views);
/** Hear the views on the list change. */
export const onViews = (f) => (heardViews.add(f), () => heardViews.delete(f));

/** Keep a new list: on the person item where there is one, else in this browser. Told at once; put back if refused. */
async function keep(next, reason, nextViews = views) {
  const was = list, viewsWere = views;
  list = next;
  views = nextViews;
  told();
  const whole = listWith(next, nextViews);
  const id = await me();
  try {
    if (id) await api('change', { ops: [{ op: 'update', id, props: { islands: whole } }], reason });
    else localStorage.setItem(LOCAL, JSON.stringify(whole));
  } catch (err) {
    list = was;
    views = viewsWere;
    told();
    throw err;
  }
}

/** Keep `next` as the person's list: what the picker makes of a press (./islands-list.js, pressed). */
export async function keepList(next, reason) {
  await islandsOn();
  await keep(clean(next), reason);
}

/** Keep `next` as the views on the person's list, the islands as they are. */
export async function keepViews(next, reason) {
  await islandsOn();
  await keep(list, reason, viewsIn(listWith([], next)));
}

/** Where each island stands on every canvas (its focus's field `corner`), by id: null where no agent has set one. */
export const corners = {};
/** Read the corners of these islands not read yet. */
export async function cornersOf(ids) {
  const missing = ids.filter((id) => /^e_/.test(id) && !(id in corners));
  const got = await Promise.all(missing.map((id) => api('get', { id }).catch(() => null)));
  missing.forEach((id, k) => (corners[id] = got[k]?.entity?.props?.corner ?? null));
  return corners;
}
