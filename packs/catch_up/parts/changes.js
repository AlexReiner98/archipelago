// A change set: the log between two positions, as a person would tell it (task e_p3tygg6p). What came, what left, what
// changed (its title, status, note, owner, fields), what was linked or unlinked; each with who made it, on whose word
// and why (`by`, as the tail sends it: packs/log/kernel/tail.ts).
//
// The runtime projects the facts (it holds the store and the projector, packs/log/kernel/project.ts) and hands each row
// the facts touched as it stood before them and after, as data; this compares the two. Pure: rows in, the set out.

/** An item's head fields a change is told by, beside its own fields. */
const HEAD = ['title', 'status', 'body', 'owner', 'visibility'];
const liveItem = (r) => Boolean(r && !r.archived_at);
const liveLink = (r) => Boolean(r && !r.valid_to);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** A link's id, as the log names one. */
export const isLink = (id) => typeof id === 'string' && id.startsWith('r_');

/** What differs between the fields of two rows, `props` beside what `head` names. */
function fieldsOf(was, now, head) {
  const out = head.filter(([f]) => !same(was[f], now[f])).map(([f, field]) => ({ field, was: was[f] ?? null, now: now[f] ?? null }));
  const props = new Set([...Object.keys(was.props ?? {}), ...Object.keys(now.props ?? {})]);
  for (const field of props) if (!same(was.props?.[field], now.props?.[field])) out.push({ field, was: was.props?.[field] ?? null, now: now.props?.[field] ?? null });
  return out;
}
const ITEM_HEAD = HEAD.map((f) => [f, f]);
const LINK_HEAD = [['type', 'type'], ['from_id', 'from'], ['to_id', 'to']];

/**
 * The change set of rows as they were and are (`{ id, was, now, by?, at?, pos? }` each, was or now null where the row
 * was not held or is gone), between `from` and `to`. One change per item or link, its latest maker in `by`, `at` and
 * `pos`; a link's change carries its type and ends. What came and left between the two positions, or was said again as
 * it was, is no change.
 */
export function changeSet({ from = null, to = null, rows = [] } = {}) {
  const items = [];
  const links = [];
  for (const { id, was, now, by, at, pos } of rows) {
    const said = { ...(by && { by }), ...(at !== undefined && { at }), pos: pos ?? to };
    if (!isLink(id)) {
      if (!liveItem(was) && liveItem(now)) items.push({ id, did: 'came', type: now.type, title: now.title, ...said });
      else if (liveItem(was) && !liveItem(now)) items.push({ id, did: 'left', type: was.type, title: was.title, ...(now ? {} : { forgotten: true }), ...said });
      else if (liveItem(was) && liveItem(now)) {
        const fields = fieldsOf(was, now, ITEM_HEAD);
        if (fields.length) items.push({ id, did: 'changed', type: now.type, title: now.title, fields, ...said });
      }
      continue;
    }
    const ends = (r) => ({ type: r.type, from: r.from_id, to: r.to_id });
    if (!liveLink(was) && liveLink(now)) links.push({ id, did: 'linked', ...ends(now), ...said });
    else if (liveLink(was) && !liveLink(now)) links.push({ id, did: 'unlinked', ...ends(was), ...said });
    else if (liveLink(was) && liveLink(now)) {
      const fields = fieldsOf(was, now, LINK_HEAD);
      if (fields.length) links.push({ id, did: 'changed', ...ends(now), fields, ...said });
    }
  }
  return { from, to, items, links };
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

/** What a change did, in a few words: "came", "doing", "linked depends on", "title, text". */
export function said(c) {
  if (c.did === 'changed' && c.fields?.length) {
    const status = c.fields.find((f) => f.field === 'status');
    const rest = c.fields.filter((f) => f !== status).map((f) => (f.field === 'body' ? 'text' : f.field));
    return [status && `${status.now}`, ...rest].filter(Boolean).join(', ');
  }
  if (c.did === 'linked' || c.did === 'unlinked') return `${c.did} ${c.type.replace(/_/g, ' ')}`;
  return c.did;
}

/** Who made a change, as a person reads it: the session by its word, else the actor's name. */
export function whoSaid(by) {
  if (by?.word) return `Session ${by.word}`;
  if (by?.name) return by.name;
  const raw = by?.actor ?? '';
  return raw.split(/[/:]/).at(-1) || 'Someone';
}

/** A reason's first clause, as the page shows one. */
export const gist = (text) => (typeof text === 'string' ? text : '').split(/(?<=[.:;])\s|\n/)[0].replace(/[.:;]$/, '');
