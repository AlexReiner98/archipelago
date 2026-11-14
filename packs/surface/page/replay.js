// A replay a part answers with (['replay', { at, steps: [{ pos, ids }] }]: packs/walls/page/part-check.js): the canvas it
// stands over shows what the person missed, step by step. The part decides the steps and drives the timer; the page holds
// the store. What was missed is the store's (`store.missed`, { view, then, entries, from, to }, set as the canvas
// mounts: packs/surface/page/live.js): `then` the rows as the person left them, `entries` the log since. At step 0 the
// view's rows are rewound to `then` and the store is `playing` (the live beat leaves it alone); each step plays the facts
// of entry `pos` whose id is in `ids`, through the store, once; no replay mark puts the store where the map is now.

/** Where each store's replay stands: the steps played, and what they were made from. */
const played = new WeakMap();

/** The facts a step plays: those of entry `pos` about its ids. */
export function stepsFrom(entries, steps) {
  const byPos = new Map(entries.map((e) => [e.pos, e]));
  return steps.flatMap(({ pos, ids }) => {
    const e = byPos.get(pos);
    if (!e) return [];
    const keep = new Set(ids);
    return [{ ...e, facts: e.facts.filter((f) => keep.has(f[1])) }];
  });
}

/**
 * Take a view's rows in the page's one store back to `then`, as they were at `from`: what was made since leaves while it
 * plays, and every row the steps touch is current to `from` again, so each fact is projected once as its step comes.
 */
function rewind(view, then, from, steps) {
  const s = view.store;
  for (const id of view.ids) if (!then.items.has(id)) s.items.delete(id);
  for (const [id] of view.links) if (!then.links.has(id)) s.links.delete(id);
  for (const [id, r] of then.items) s.items.set(id, r);
  for (const [id, r] of then.links) s.links.set(id, r);
  for (const id of [...then.items.keys(), ...then.links.keys(), ...steps.flatMap((x) => x.facts.map((f) => f[1]))]) s.at.set(id, from);
}

/** One step played through the store, projected at its position, once. */
function replay(view, step) {
  const s = view.store;
  for (const f of step.facts) if (s.at.get(f[1]) >= step.pos) s.at.set(f[1], step.pos - 0.5);
  return s.apply({ pos: step.pos, entries: [step] });
}

const nothing = () => ({ items: { added: [], changed: [], removed: [] }, links: { added: [], changed: [], removed: [] } });

/**
 * Show `store`'s missed entries up to step `r.at` of `r.steps`, or (r null) the map as it is now: what was not played
 * projected at once (by `project`, the projector the page runs), every row current to `to`, and `playing` off. A step
 * back, or other steps, rewinds and plays again.
 */
export function replayIn(store, r, project) {
  const m = store?.missed;
  const was = played.get(store);
  if (!r) {
    if (!was) return;
    played.delete(store);
    const view = m?.view ?? was.view;
    for (const s of was.steps.slice(was.at)) project(store, store.kinds, s.at, s.facts);
    const to = m?.to ?? was.to;
    for (const id of [...store.items.keys(), ...store.links.keys()]) if (!(store.at.get(id) >= to)) store.at.set(id, to);
    store.playing = false;
    view?.tell?.(nothing());
    return;
  }
  if (!m?.view) return;
  const steps = stepsFrom(m.entries ?? [], r.steps);
  const same = was && was.said === JSON.stringify(r.steps) && r.at >= was.at;
  const now = same ? was : { at: 0, steps, said: JSON.stringify(r.steps), view: m.view, to: m.to };
  if (!same) {
    store.playing = true;
    rewind(m.view, m.then, m.from, steps);
    m.view.tell?.(nothing());
  }
  played.set(store, now);
  for (; now.at < Math.min(r.at, steps.length); now.at++) replay(m.view, steps[now.at]);
}
