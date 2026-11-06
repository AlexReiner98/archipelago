import { changeSet } from './changes.js';
import { isLink, project } from './project.js';

// ---- the steps a catch-up plays, worked out from the log --------------------------
//
// Pure: rows and entries in, rows and steps out, with the projector the page and the server run (src/project.ts).
// ui/catch-up.js plays them; test/catch-up.test.ts checks them without a page.

/** What a store's items and links were at a position: the facts said of them up to it, folded from nothing. */
export function rowsAt(kinds, entries) {
  const was = { items: new Map(), links: new Map() };
  for (const e of entries) project(was, kinds, e.at, e.facts);
  return was;
}

/**
 * The store as it was before `entries`, from the store as it is (`now`) and the rows as they stood (`was`): each id
 * the entries touch is put back as it was, or taken out if it was made in them. One with no history before them (an
 * item from before the log) is left as it is.
 */
export function before(now, was, entries) {
  const out = { items: new Map(now.items), links: new Map(now.links) };
  const made = new Set(entries.flatMap((e) => e.facts.filter((f) => f[0] === '+' && (f[2] === 'type' || f[2] === 'link')).map((f) => f[1])));
  for (const e of entries) for (const f of e.facts) {
    const key = isLink(f[1]) ? 'links' : 'items';
    const row = was[key].get(f[1]);
    if (row && now[key].has(f[1])) out[key].set(f[1], now[key].get(f[1])?.session ? { ...row, session: now[key].get(f[1]).session } : row);
    else if (made.has(f[1])) out[key].delete(f[1]);
  }
  return out;
}

/** Who made an entry, for telling chapters apart: its session, else its actor. */
const makerOf = (e) => e.by?.run ?? e.by?.actor ?? '';

/**
 * The steps a catch-up plays: each change set in turn, in chapters of one maker each, and each set's facts island by
 * island, in the order the islands first come. `held` ({ items, links }, as it was) says where each item lives; a link lives
 * where its first end does. A step that changes nothing drawn is dropped. `kinds`: what the projector asks of the
 * types. Pure: tested without a page.
 */
export function stepsOf(kinds, held, entries, mine) {
  const chapters = [];
  for (const e of entries) {
    if (mine && e.by?.actor === mine) continue;
    const last = chapters.at(-1);
    if (last && makerOf(last.at(-1)) === makerOf(e)) last.push(e);
    else chapters.push([e]);
  }
  const copy = { items: new Map(held.items), links: new Map(held.links) };
  const islandOf = (id) => {
    if (!isLink(id)) return copy.items.get(id)?.props?.island ?? '';
    const r = copy.links.get(id);
    return r ? islandOf(r.from_id) : '';
  };
  const steps = [];
  chapters.forEach((chapter, n) => {
    for (const { pos, at, by, facts, moved } of chapter) {
      // What each fact is about, and where it lives: an item made here lives where its own facts say.
      const where = new Map();
      for (const f of facts) {
        if (where.has(f[1])) continue;
        const own = isLink(f[1]) ? undefined : facts.find((g) => g[1] === f[1] && g[0] === '+' && g[2] === 'island')?.[3];
        const end = isLink(f[1]) ? facts.find((g) => g[1] === f[1] && g[0] === '+' && g[2] === 'link')?.[3]?.[1] : undefined;
        where.set(f[1], own ?? (end ? where.get(end) ?? islandOf(end) : islandOf(f[1])));
      }
      for (const island of new Set(where.values())) {
        const step = { pos, at, by, ...(moved && { moved }), facts: facts.filter((f) => where.get(f[1]) === island) };
        const set = changeSet(copy, kinds, [step]);
        project(copy, kinds, at, step.facts, Boolean(moved));
        if (set.items.length || set.links.length) steps.push({ ...step, island, chapter: n, set });
      }
    }
  });
  return steps;
}

/**
 * Take a view's rows in the page's one store (ui/replica.js) back to `then`, as they were at `from`: what was made
 * since leaves while it plays, and every row the steps touch is current to `from` again, so each fact is projected
 * once as its step comes. Other views' rows are left as they are.
 */
export function rewind(view, then, from, steps) {
  const s = view.store;
  for (const id of view.ids) if (!then.items.has(id)) s.items.delete(id);
  for (const [id] of view.links) if (!then.links.has(id)) s.links.delete(id);
  for (const [id, r] of then.items) s.items.set(id, r);
  for (const [id, r] of then.links) s.links.set(id, r);
  for (const id of [...then.items.keys(), ...then.links.keys(), ...steps.flatMap((x) => x.facts.map((f) => f[1]))]) s.at.set(id, from);
}

/** One step played through the store: several can come from one entry (its islands, in turn), each projected at its position, once. */
export function replay(view, step) {
  const s = view.store;
  for (const f of step.facts) if (s.at.get(f[1]) >= step.pos) s.at.set(f[1], step.pos - 0.5);
  return s.apply({ pos: step.pos, entries: [step] });
}
