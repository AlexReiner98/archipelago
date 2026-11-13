import { ghostsOf, withGhosts } from './ghosts.js';
import { mayMove, reads } from './membership.js';
import { isLink, NOTE_START, project } from './project.js';

// ---- the page as a replica of the log -------------------------------------
//
// The page keeps one store of items and links by id, shared by every view open on it (the owner, 5 Nov 2026,
// e_5cdm9bfg): a view holds only the ids of its answer, and the rows are the store's. The store is kept current by
// projecting the facts the server sends after its position (packs/surface/page/live.js tails them, packs/log/kernel/tail.ts reads them), with the
// projector the server runs (packs/log/kernel/project.ts, served as /project.js): a fact updates its item once, and every view
// holding it is told. Which items a view shows is the server's to judge: a fact that may change what its query finds
// (packs/surface/page/membership.js) tells the view to ask for its answer again (`ask`), and the store never judges a filter itself.
// Each row keeps the position it is current to, so a view that read its answer later than the store stands brings
// rows newer than the facts still to come, and those facts are not folded onto them twice. Beside the rows the store
// keeps the changes held for the owner (`held`, the pending proposals, read again as the queue moves) and the links
// the person drew here that the server has not yet answered for (`mine`): a view's `drawn()` is its answer with both
// drawn into it (ui/ghosts.js), what the canvas hands its drawing.

/** An item of a lens answer as the row the projector folds facts into. */
const itemRow = (i) => ({
  id: i.id, type: i.type, title: i.title, body: i.body ?? '', status: i.status, visibility: i.visibility,
  owner: i.owner ?? null, is_open: i.open, props: { ...(i.fields ?? {}), ...(i.island && { island: i.island }) }, created_at: i.created_at, updated_at: i.updated_at, archived_at: null,
  // A run's session is worked out by the server from its events, not folded from facts: kept as the answer gave it.
  ...(i.session && { session: i.session }),
});
const linkRow = (r) => ({ id: r.id, type: r.type, from_id: r.from, to_id: r.to, props: { ...(r.props ?? {}) }, valid_to: null });

/** What changed, by what it is: made, changed or gone (archived, ended, forgotten, out of sight). */
const blank = () => ({ items: { added: [], changed: [], removed: [] }, links: { added: [], changed: [], removed: [] } });
const anyIn = (changed) => ['items', 'links'].some((k) => Object.values(changed[k]).some((list) => list.length));
const ISLAND_ID = /^e_[a-z0-9]{8}$/;

/** The one store: every item and link an open view holds, by id. */
export class Store {
  /** kinds: what the projector asks of the types (isOpen, type, relationFamily), shown(type, field) for the fields a lens sends, phase(type, status), flavour(link) and lineage(type) as the server's answer gives them. */
  constructor(kinds) {
    this.kinds = kinds;
    this.items = new Map();
    this.links = new Map();
    /** The position each row is current to. */
    this.at = new Map();
    this.views = new Set();
    this.held = [];
    this.mine = new Map();
    this.drew = 0;
    this.head = undefined;
  }

  /** Where the tail reads from: the oldest row held, or where the log stood when last read. */
  get pos() {
    let low;
    for (const p of this.at.values()) if (low === undefined || p < low) low = p;
    return low ?? this.head ?? 0;
  }

  /** Take a lens answer read at `pos` (read before the answer, so nothing between is missed): a row held already and as new is kept. */
  take(answer, pos) {
    for (const i of answer.items ?? []) {
      if (!(this.at.get(i.id) >= pos)) (this.items.set(i.id, itemRow(i)), this.at.set(i.id, pos));
      // A session's state and line are no facts' (itemRow): the latest answer's are the ones, whatever the row's position.
      else if (i.session && this.items.has(i.id)) this.items.get(i.id).session = i.session;
    }
    for (const r of answer.links ?? []) if (!(this.at.get(r.id) >= pos)) (this.links.set(r.id, linkRow(r)), this.at.set(r.id, pos));
    this.head = Math.max(this.head ?? pos, pos);
  }

  /** A view kept current from now on. */
  keep(view) {
    this.views.add(view);
    return view;
  }

  /** A view no longer drawn: what no other view holds is let go. */
  drop(view) {
    if (this.views.delete(view)) this.trim();
  }

  /** Let go of what no view holds, and the links whose ends are not both held. */
  trim() {
    const kept = new Set([...this.views].flatMap((v) => [...v.ids]));
    for (const id of this.items.keys()) if (!kept.has(id)) (this.items.delete(id), this.at.delete(id));
    for (const [id, r] of this.links) if (!kept.has(r.from_id) || !kept.has(r.to_id)) (this.links.delete(id), this.at.delete(id));
  }

  /** The ids the tail reads facts on: every item and link held, and the items the views' queries name. */
  ids() {
    return [...new Set([...this.items.keys(), ...this.links.keys(), ...[...this.views].flatMap((v) => [...v.reads.anchors])])];
  }

  /** The islands the open views touch: those their items live on and those their queries name. */
  islands() {
    return [...new Set([...this.views].flatMap((v) => v.touched()))].filter((id) => ISLAND_ID.test(id));
  }

  /** The entries with only the facts a row held is not current to already. */
  fresh(entries = []) {
    return entries.map((e) => ({ ...e, facts: e.facts.filter((f) => !(this.at.get(f[1]) >= e.pos)) })).filter((e) => e.facts.length);
  }

  /** A fact as it bears on what views find, read before it is folded in: its link's ends, whether it makes an item, the island it is on. */
  touch(f, entry) {
    const [op, id, field] = f;
    if (isLink(id)) {
      const r = this.links.get(id);
      const ends = field === 'link' && op === '+' ? f[3] : r && [r.type, r.from_id, r.to_id];
      return { id, field, op, ...(ends && { link: { type: ends[0], from: ends[1], to: ends[2] } }) };
    }
    const r = this.items.get(id);
    const said = entry.facts.find((g) => g[1] === id && g[2] === 'island' && g[0] === '+');
    const island = said ? said[3] : r ? r.props?.island : '?';
    return { id, field, op, ...(!r && field === 'type' && op === '+' && { made: true }), ...(island !== undefined && { island }) };
  }

  /**
   * Project a tail's answer ({ pos, entries, gone, made }): each fact after its row's position, in order, once. Every
   * view holding what changed is told, and a view whose answer the facts may change is told to ask again (`ask`).
   * Answers what changed in the store.
   */
  apply(tail) {
    const was = new Map(this.items);
    const wasLinks = new Map(this.links);
    const moved = { items: new Set(), links: new Set(), gone: new Set(tail.gone ?? []) };
    const touches = [];
    for (const e of this.fresh(tail.entries)) {
      for (const f of e.facts) touches.push(this.touch(f, e));
      project(this, this.kinds, e.at, e.facts, Boolean(e.moved), moved);
    }
    this.head = Math.max(this.head ?? 0, tail.pos ?? 0);
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
    // A link drawn here whose fact has come: it is drawn as it is now, no longer pending.
    for (const id of changed.links.added) {
      const r = this.links.get(id);
      for (const [key, l] of this.mine) if (l.type === r.type && l.from === r.from_id && l.to === r.to_id) this.mine.delete(key);
    }
    // Every row held is current to where the tail stopped.
    const to = tail.pos ?? 0;
    for (const id of [...this.items.keys(), ...this.links.keys()]) if (!(this.at.get(id) >= to)) this.at.set(id, to);
    for (const view of [...this.views]) view.hear(changed, wasLinks, touches, tail.made ?? 0);
    // What the facts brought that no view holds is not kept: a view that should hold it asks for it.
    this.trim();
    return changed;
  }

  /** Keep these held changes (the pending proposals); every view is told when what is held moved. */
  holdChanges(proposals) {
    const said = JSON.stringify(proposals ?? []);
    if (said === this.heldSaid) return;
    this.heldSaid = said;
    this.held = proposals ?? [];
    this.tellAll();
  }

  /** A link the person drew, drawn at once as pending until its fact arrives or it is refused (`forget`): answers its key. */
  expect({ type, from, to }) {
    const id = `mine:${++this.drew}`;
    this.mine.set(id, { id, type, from, to });
    this.tellAll();
    return id;
  }

  /** Stop drawing a link drawn here: refused, held for the owner instead, or arrived. */
  forget(id) {
    if (this.mine.delete(id)) this.tellAll();
  }

  tellAll() {
    for (const view of [...this.views]) view.tell({ ...blank(), held: true });
  }
}

/** A view's hold on the store: the ids of its answer, and what its answer said of them beside their rows. */
export class View {
  constructor(store) {
    this.store = store;
    this.kinds = store.kinds;
    this.ids = new Set();
    this.listeners = new Set();
    this.why = new Map();
    this.placed = new Map();
    this.whole = new Set();
    this.reads = reads(undefined);
  }

  /** Hold a lens answer read at a position: `pos` must be read before the answer, so nothing between is missed. */
  hold(answer, pos) {
    this.store.take(answer, pos);
    this.ids = new Set((answer.items ?? []).map((i) => i.id));
    // Why each was in the answer (the terms that found it, or the walk's step): the answer's, not the log's, so kept apart.
    // And why the frontier found it (`reasons`), worked out by the server as the lens was read.
    this.why = new Map((answer.items ?? []).filter((i) => i.found || i.step).map((i) => [i.id, { ...(i.found ? { found: i.found, terms: i.terms } : { step: i.step }), ...(i.reasons && { reasons: i.reasons }) }]));
    // Where each falls on the lens's time axis, its lane and what it counts toward, worked out by the server: kept until the lens is read again.
    this.placed = new Map((answer.items ?? []).filter((i) => i.time).map((i) => [i.id, { time: i.time, ...(i.lane !== undefined && { lane: i.lane }), ...(i.stream !== undefined && { stream: i.stream }) }]));
    // The items whose notes the lens was asked to send whole (`notes`, for the pages): kept whole as they change.
    this.whole = new Set(answer.whole ?? []);
    this.lens = answer.lens;
    this.reads = reads(answer.lens);
    this.viewer = answer.viewer;
    // The islands' names, as the answer gave them: a drawing names each island's border by them.
    this.islands = answer.islands;
  }

  /** Where the store's tail stands, what is held for the owner and the links drawn here: the store's, shared. */
  get pos() {
    return this.store.pos;
  }
  get held() {
    return this.store.held;
  }
  get mine() {
    return this.store.mine;
  }
  /** The rows of the items this view holds, by id. */
  get items() {
    return new Map([...this.ids].filter((id) => this.store.items.has(id)).map((id) => [id, this.store.items.get(id)]));
  }
  /** The rows of the links among them. */
  get links() {
    return new Map([...this.store.links].filter(([, r]) => this.ids.has(r.from_id) && this.ids.has(r.to_id)));
  }

  /** The islands this view touches: those its items live on, and those its query names. */
  touched() {
    const out = new Set(this.reads.islands);
    for (const id of this.ids) {
      const island = this.store.items.get(id)?.props?.island;
      if (typeof island === 'string') out.add(island);
    }
    return [...out];
  }

  /** An item of this view as a lens answer gives it, or undefined: what a drawing reads. */
  item(id) {
    const r = this.ids.has(id) ? this.store.items.get(id) : undefined;
    if (!r || r.archived_at) return undefined;
    const fields = Object.fromEntries(Object.entries(r.props ?? {}).filter(([k, v]) => v != null && this.kinds.shown?.(r.type, k) !== false));
    return {
      id: r.id, type: r.type, ...(this.kinds.lineage?.(r.type)?.length && { is: this.kinds.lineage(r.type) }), title: r.title,
      ...(r.body && { body: r.body.length > NOTE_START && !this.whole.has(id) ? `${r.body.slice(0, NOTE_START)}…` : r.body }),
      visibility: r.visibility, status: r.status, ...(this.kinds.phase?.(r.type, r.status) && { phase: this.kinds.phase(r.type, r.status) }), open: r.is_open, owner: r.owner, created_at: r.created_at, updated_at: r.updated_at,
      ...(Object.keys(fields).length && { fields }),
      // The island it lives on, on a map with islands on: a field kept on the item, not shown, read by a drawing for its borders.
      ...(typeof r.props?.island === 'string' && { island: r.props.island }),
      ...(r.session && { session: r.session }),
      ...this.why.get(id),
      ...this.placed.get(id),
    };
  }

  /** The view as a lens answer: its items not archived, the live links among them. */
  answer() {
    const items = [...this.ids].map((id) => this.item(id)).filter(Boolean);
    const shown = new Set(items.map((i) => i.id));
    const links = [...this.store.links.values()]
      .filter((r) => !r.valid_to && shown.has(r.from_id) && shown.has(r.to_id))
      .map((r) => ({ id: r.id, type: r.type, ...(this.kinds.flavour?.(r.type)?.length && { is: this.kinds.flavour(r.type) }), from: r.from_id, to: r.to_id, ...(Object.keys(r.props ?? {}).length && { props: r.props }) }));
    return { ...(this.lens && { lens: this.lens }), ...(this.viewer && { viewer: this.viewer }), ...(this.islands && { islands: this.islands }), items, links };
  }

  /** The answer with what is held for the owner drawn where it would land, and the links drawn here and not yet answered for. */
  drawn() {
    const holds = (id) => Boolean(this.item(id));
    return withGhosts(this.answer(), ghostsOf(this.store.held, holds, Boolean(this.lens?.find?.includes('held'))), [...this.store.mine.values()]);
  }

  /** What the store's facts changed of this view, and whether its answer may have moved: told when either is so. */
  hear(changed, wasLinks, touches, made) {
    const ours = (r) => Boolean(r && this.ids.has(r.from_id) && this.ids.has(r.to_id));
    const out = blank();
    for (const k of ['added', 'changed', 'removed']) {
      out.items[k] = changed.items[k].filter((id) => this.ids.has(id));
      out.links[k] = changed.links[k].filter((id) => ours(this.store.links.get(id)) || ours(wasLinks.get(id)));
    }
    const sessions = new Set([...this.ids].filter((id) => this.store.items.get(id)?.session));
    out.ask = mayMove({ lens: this.lens, reads: this.reads, items: this.ids, islands: this.touched(), sessions }, touches, made);
    if (out.ask || anyIn(out)) this.tell(out);
    return out;
  }

  holdChanges(proposals) {
    this.store.holdChanges(proposals);
  }
  expect(link) {
    return this.store.expect(link);
  }
  forget(id) {
    this.store.forget(id);
  }

  tell(changed) {
    for (const listen of this.listeners) listen(changed, this);
  }

  /** Call `listen(changed, view)` whenever facts change what the view holds; answers how to stop. */
  on(listen) {
    this.listeners.add(listen);
    return () => this.listeners.delete(listen);
  }
}

/** A view kept current from the log from now on (packs/surface/page/live.js tails for its store). */
export const follow = (view) => view.store.keep(view);
/** A view no longer drawn: it is no longer kept current, and what only it held is let go. */
export const unfollow = (view) => view?.store?.drop(view);
