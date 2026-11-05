import { project } from './project.js';

// ---- a change set: the log between two positions ---------------------------
//
// What changed between two positions of the log, as a person would tell it: what came, what left, what changed (its
// title, status, note, owner, fields), what was linked or unlinked; each with who made it, on whose word and why
// (`by`, as the tail sends it: src/tail.ts). Worked out by projecting the facts after the first position onto a copy
// of what a store holds, with the projector the page and the server run (src/project.ts), and comparing each row
// touched as it was before the first entry with how it stands after the last. Pure: rows and entries in, the set
// out; it changes nothing it is handed (test/change-set.test.ts).

/** An item's head fields a change is told by, beside its own fields. */
const HEAD = ['title', 'status', 'body', 'owner', 'visibility'];
const liveItem = (r) => Boolean(r && !r.archived_at);
const liveLink = (r) => Boolean(r && !r.valid_to);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What differs between two rows of an item: each head field, then each field, with what it was and is now. */
function itemFields(was, now) {
  const out = HEAD.filter((f) => !same(was[f], now[f])).map((field) => ({ field, was: was[field] ?? null, now: now[field] ?? null }));
  const props = new Set([...Object.keys(was.props ?? {}), ...Object.keys(now.props ?? {})]);
  for (const field of props) if (!same(was.props?.[field], now.props?.[field])) out.push({ field, was: was.props?.[field] ?? null, now: now.props?.[field] ?? null });
  return out;
}
/** What differs between two rows of a link: its type, its ends, its fields. */
function linkFields(was, now) {
  const out = ['type', 'from_id', 'to_id'].filter((f) => was[f] !== now[f]).map((f) => ({ field: f.replace('_id', ''), was: was[f], now: now[f] }));
  const props = new Set([...Object.keys(was.props ?? {}), ...Object.keys(now.props ?? {})]);
  for (const field of props) if (!same(was.props?.[field], now.props?.[field])) out.push({ field, was: was.props?.[field] ?? null, now: now.props?.[field] ?? null });
  return out;
}

/**
 * The change set of the entries after `after` (each { pos, at, facts, moved?, by? }), over rows held as `held`
 * ({ items, links }: Maps by id, as a Replica keeps them). `kinds`: what the projector asks of the types. `gone`: what
 * the reader held and may no longer see (the tail's `gone`), which left. Answers { from, to, items, links }: one
 * change per item or link, its latest maker in `by`, `at` and `pos`; a link's change carries its type and ends.
 * What came and left between the two positions, or was said again as it was, is no change.
 */
export function changeSet(held, kinds, entries = [], { after = -Infinity, gone = [] } = {}) {
  const now = { items: new Map(held.items), links: new Map(held.links) };
  /** Each row touched, as it stood before the first entry (null: not held). */
  const first = { items: new Map(), links: new Map() };
  /** Who last touched each, and when. */
  const last = new Map();
  let to = after;
  const note = (key, id) => first[key].has(id) || first[key].set(id, now[key].get(id) ?? null);
  for (const e of entries) {
    if (!(e.pos > after)) continue;
    to = Math.max(to, e.pos);
    // Each row as it was, the first time anything touched it: what a forget takes with it (its links) as well.
    for (const f of e.facts) {
      const id = f[1];
      note(id.startsWith('r_') ? 'links' : 'items', id);
      if (f[2] === 'forgotten') for (const [rid, r] of now.links) if (r.from_id === id || r.to_id === id) note('links', rid);
    }
    const moved = project(now, kinds, e.at, e.facts, Boolean(e.moved));
    const said = { ...(e.by && { by: e.by }), at: e.at, pos: e.pos };
    for (const id of [...moved.items, ...moved.links, ...moved.gone]) last.set(id, said);
  }
  for (const id of gone) {
    for (const key of ['items', 'links']) if (now[key].has(id)) (note(key, id), now[key].delete(id));
  }
  const items = [];
  for (const [id, was] of first.items) {
    const row = now.items.get(id);
    const said = last.get(id) ?? { pos: to };
    if (!liveItem(was) && liveItem(row)) items.push({ id, did: 'came', type: row.type, title: row.title, ...said });
    else if (liveItem(was) && !liveItem(row)) items.push({ id, did: 'left', type: was.type, title: was.title, ...(row ? {} : { forgotten: true }), ...said });
    else if (liveItem(was) && liveItem(row)) {
      const fields = itemFields(was, row);
      if (fields.length) items.push({ id, did: 'changed', type: row.type, title: row.title, fields, ...said });
    }
  }
  const links = [];
  for (const [id, was] of first.links) {
    const row = now.links.get(id);
    const said = last.get(id) ?? { pos: to };
    const ends = (r) => ({ type: r.type, from: r.from_id, to: r.to_id });
    if (!liveLink(was) && liveLink(row)) links.push({ id, did: 'linked', ...ends(row), ...said });
    else if (liveLink(was) && !liveLink(row)) links.push({ id, did: 'unlinked', ...ends(was), ...said });
    else if (liveLink(was) && liveLink(row)) {
      const fields = linkFields(was, row);
      if (fields.length) links.push({ id, did: 'changed', ...ends(row), fields, ...said });
    }
  }
  return { from: after, to, items, links };
}

/**
 * The items a change set marks, by id: each item it changed, and both ends of each link it made, ended or changed
 * (an item's own change is told before a link's). What a page traces.
 */
export function touched(set) {
  const out = new Map();
  for (const c of set.items) out.set(c.id, c);
  for (const c of set.links) for (const end of [c.from, c.to]) if (!out.has(end)) out.set(end, c);
  return out;
}

/** What a change did, in a few words: "came", "status doing", "linked depends_on", "title, text". */
export function said(c) {
  if (c.did === 'changed' && c.fields?.length) {
    const status = c.fields.find((f) => f.field === 'status');
    const rest = c.fields.filter((f) => f !== status).map((f) => (f.field === 'body' ? 'text' : f.field));
    return [status && `${status.now}`, ...rest].filter(Boolean).join(', ');
  }
  if (c.did === 'linked' || c.did === 'unlinked') return `${c.did} ${c.type.replace(/_/g, ' ')}`;
  return c.did;
}
