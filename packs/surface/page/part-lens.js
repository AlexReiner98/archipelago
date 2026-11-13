// What a part on a frame slot that draws from the canvas's query is handed beside its item (tasks e_gaa2ubge,
// e_926g89jb): the lens up (Home's when no query is), with `said`, so no part keeps the lens algebra; the answer in
// brief; and `names`, the titles of the items the lens names. The canvas in focus says what it draws (hooks.address,
// hooks.answer, hooks.homeLens: packs/surface/page/canvas.js); what needs no page is packs/walls/page/part-slots.js.

import { hooks, state } from './base.js';
import { idsNamed } from './lens-terms.js';
import { itemOf } from './layout-asks.js';
import { ANSWER_SLOTS, QUERY_SLOTS, SHAPE_SLOTS, answerBrief, withSaid } from './part-slots.js';

/** How many names of items a part is handed. */
const namesMost = 50;

/** The titles of the items a lens names: those the answer holds, the rest read as the person may read them (unread ones left out). */
export async function namesOf(lens, answer) {
  const ids = idsNamed(lens?.filter).slice(0, namesMost);
  const held = new Map((answer?.items ?? []).map((i) => [i.id, i.title]));
  const read = await Promise.all(ids.map((id) => (held.has(id) ? held.get(id) : itemOf(id).then((x) => x?.title, () => undefined))));
  return Object.fromEntries(ids.map((id, i) => [id, read[i]]).filter(([, t]) => typeof t === 'string'));
}

/** The page's address as a part that declares `go` is handed it: its lens with `said`, as every lens handed to a part. */
export async function addressSaid(words) {
  const at = hooks.address?.() ?? null;
  // Home draws a lens too: handed as `home`, so a term a part adds there adds to Home's.
  if (at && !at.query) return { ...at, home: withSaid(hooks.homeLens?.() ?? null, words, {}) };
  if (!at?.query) return at;
  return { ...at, query: withSaid(at.query, words, await namesOf(at.query, hooks.answer?.()?.answer)) };
}

/** What a part filling `slot` is handed of the canvas's query, or nothing for a slot that is not handed it. */
export async function queryGiven(slot, words) {
  if (!QUERY_SLOTS.includes(slot)) return {};
  const at = hooks.address?.() ?? null;
  const up = hooks.answer?.() ?? null;
  const lens = at?.query ?? hooks.homeLens?.() ?? null;
  const names = await namesOf(lens, up?.answer);
  return {
    query: withSaid(lens, words, names),
    home: !at?.query,
    names,
    ...(ANSWER_SLOTS.includes(slot) && { answer: answerBrief(up?.answer, { failed: up?.failed, limit: lens?.limit }) }),
    ...(SHAPE_SLOTS.includes(slot) && { shapes: (state.schema?.shapes ?? []).filter((s) => typeof s?.shape === 'string').map((s) => ({ shape: s.shape, title: String(s.title ?? s.shape) })) }),
  };
}
