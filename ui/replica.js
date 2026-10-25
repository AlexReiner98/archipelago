import { NOTE_START, project } from './project.js';

// ---- the page as a replica of the log -------------------------------------
//
// A store holds a flat lens's answer as items and links by id, and keeps it current by projecting the facts the
// server sends after its position (ui/live.js tails them, src/tail.ts reads them), with the projector the server
// runs (src/project.ts, served as /project.js). A change made anywhere reaches it without the lens being read again;
// listeners are told what changed. The store keeps what it was given and what links bring to it: it does not judge
// the lens's filter again, so an item that no longer matches stays until the lens is read again.

/** An item of a lens answer as the row the projector folds facts into. */
const itemRow = (i) => ({
  id: i.id, kind: i.kind ?? null, type: i.type, title: i.title, body: i.body ?? '', status: i.status, visibility: i.visibility,
  owner: i.owner ?? null, is_open: i.open, props: { ...(i.fields ?? {}) }, created_at: i.created_at, updated_at: i.updated_at, archived_at: null,
});
const linkRow = (r) => ({ id: r.id, type: r.type, from_id: r.from, to_id: r.to, props: { ...(r.props ?? {}) }, valid_to: null });

/** What changed, by what it is: made, changed or gone (archived, ended, forgotten, out of sight). */
const blank = () => ({ items: { added: [], changed: [], removed: [] }, links: { added: [], changed: [], removed: [] }, missing: [] });

export class Replica {
  /** kinds: what the projector asks of the types (isOpen, type, relationFamily), and shown(type, field) for the fields a lens sends. */
  constructor(kinds) {
    this.kinds = kinds;
    this.items = new Map();
    this.links = new Map();
    this.pos = 0;
    this.listeners = new Set();
  }

  /** Hold a lens answer read at a position: `pos` must be read before the answer, so nothing between is missed. */
  hold(answer, pos) {
    this.items = new Map((answer.items ?? []).map((i) => [i.id, itemRow(i)]));
    this.links = new Map((answer.links ?? []).map((r) => [r.id, linkRow(r)]));
    this.pos = pos;
    this.lens = answer.lens;
  }

  /** The ids the tail reads facts on: every item and link held. */
  ids() {
    return [...this.items.keys(), ...this.links.keys()];
  }

  /** An item as a lens answer gives it, or undefined: what a drawing reads. */
  item(id) {
    const r = this.items.get(id);
    if (!r || r.archived_at) return undefined;
    const fields = Object.fromEntries(Object.entries(r.props ?? {}).filter(([k, v]) => v != null && this.kinds.shown?.(r.type, k) !== false));
    return {
      id: r.id, kind: r.kind, type: r.type, title: r.title,
      ...(r.body && { body: r.body.length > NOTE_START ? `${r.body.slice(0, NOTE_START)}…` : r.body }),
      visibility: r.visibility, status: r.status, open: r.is_open, owner: r.owner, created_at: r.created_at, updated_at: r.updated_at,
      ...(Object.keys(fields).length && { fields }),
    };
  }

  /** The store as a lens answer: the items held and not archived, the live links among them. */
  answer() {
    const items = [...this.items.keys()].map((id) => this.item(id)).filter(Boolean);
    const shown = new Set(items.map((i) => i.id));
    const links = [...this.links.values()]
      .filter((r) => !r.valid_to && shown.has(r.from_id) && shown.has(r.to_id))
      .map((r) => ({ id: r.id, type: r.type, from: r.from_id, to: r.to_id, ...(Object.keys(r.props ?? {}).length && { props: r.props }) }));
    return { ...(this.lens && { lens: this.lens }), items, links };
  }

  /**
   * Project a tail's answer ({ pos, entries, gone }): each entry after the store's position, in order. Answers what
   * changed, and tells the listeners when anything did.
   */
  apply(tail) {
    const was = new Map([...this.items].map(([id, r]) => [id, r]));
    const wasLinks = new Map([...this.links].map(([id, r]) => [id, r]));
    const moved = { items: new Set(), links: new Set(), gone: new Set(tail.gone ?? []) };
    for (const e of tail.entries ?? []) if (e.pos > this.pos) project(this, this.kinds, e.at, e.facts, Boolean(e.moved), moved);
    this.pos = Math.max(this.pos, tail.pos ?? 0);
    // What the viewer can no longer see leaves, and the links that touch it.
    for (const id of moved.gone) {
      this.items.delete(id);
      this.links.delete(id);
      for (const [rid, r] of this.links) if (r.from_id === id || r.to_id === id) (this.links.delete(rid), moved.gone.add(rid));
    }
    const changed = blank();
    const sort = (key, ids, before, live) => {
      for (const id of ids) {
        const now = this[key].get(id);
        const then = before.get(id);
        if (!now || !live(now)) (then && live(then) ? changed[key].removed.push(id) : undefined);
        else changed[key][then && live(then) ? 'changed' : 'added'].push(id);
      }
    };
    sort('items', moved.items, was, (r) => !r.archived_at);
    sort('links', moved.links, wasLinks, (r) => !r.valid_to);
    for (const id of moved.gone) if (was.has(id) || wasLinks.has(id)) changed[was.has(id) ? 'items' : 'links'].removed.push(id);
    // A link made to what is not held: its other end, for the page to read if it wants it.
    for (const id of changed.links.added) for (const end of [this.links.get(id).from_id, this.links.get(id).to_id]) if (!this.items.has(end)) changed.missing.push(end);
    const any = ['items', 'links'].some((k) => Object.values(changed[k]).some((list) => list.length));
    if (any) for (const listen of this.listeners) listen(changed, this);
    return changed;
  }

  /** Call `listen(changed, store)` whenever facts change what the store holds; answers how to stop. */
  on(listen) {
    this.listeners.add(listen);
    return () => this.listeners.delete(listen);
  }
}

/** The stores the page keeps current: ui/live.js reads facts for each and hands them what it read. */
export const followed = new Set();
export const follow = (store) => (followed.add(store), store);
export const unfollow = (store) => followed.delete(store);
