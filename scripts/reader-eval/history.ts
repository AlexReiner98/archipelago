// What the map's history says a push should have changed: the open items as they stood when it landed, and the
// labels its reads earned. Pure: events and items in, fixtures' parts out, so it is tested without a map.
//
// A label is one change judged by what happened to it afterwards:
// - a proposal the owner approved (good) or declined (bad), or one already made so by a later change (good);
// - a change the reader made at once that someone later took back (bad), or that still stands (good, but weak: it
//   may only be that nobody looked);
// - an item the reader created that is a copy of one already open (bad), or that was archived or merged away;
// - an item someone else closed citing one of the push's commits, and that is still closed (good: a close the
//   reader should make).

export interface Ev {
  seq: number;
  ts: string;
  actor: string;
  action: string;
  target_id: string | null;
  target_type?: string | null;
  changeset?: string | null;
  reason?: string | null;
  detail: Record<string, any>;
}

export interface Item {
  id: string;
  type: string;
  title: string;
  status: string;
  body?: string;
}

/** An item as it is now, with what is needed to take it back in time. */
export interface Now extends Item {
  created_at: string;
  archived: boolean;
}

export type Change = 'close' | 'status' | 'create' | 'title' | 'append' | 'archive';

export interface Label {
  change: Change;
  item?: string;
  /** For a create: the title it was made with. */
  title?: string;
  /** For a status: the status it was set to. */
  to?: string;
  verdict: 'good' | 'bad';
  basis: string;
  /** Kept only because nobody undid it: counted apart. */
  weak?: boolean;
}

/** Which statuses close an item of a type. */
export type Closed = (type: string) => string[];

const STOP = new Set(['a', 'an', 'the', 'of', 'to', 'in', 'on', 'for', 'and', 'or', 'is', 'it', 'its', 'by', 'with', 'as', 'at', 'be', 'that', 'this']);
const words = (s: string) => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').split(/\s+/).filter((w) => w && !STOP.has(w)));

/** How alike two titles are: the words they share over the words either has. */
export function similar(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

/** The title among these that a new one copies, if any. */
export const copyOf = (title: string, among: string[], at = 0.6): string | undefined => among.find((t) => similar(title, t) >= at);

/** What kind of change an update op is, for an item of this type. */
export function kindOf(op: { status?: string; title?: string; append?: string; body?: string }, closed: string[]): { change: Change; to?: string } | undefined {
  if (op.status) return closed.includes(op.status) ? { change: 'close', to: op.status } : { change: 'status', to: op.status };
  if (op.title) return { change: 'title' };
  if (op.append || op.body) return { change: 'append' };
  return undefined;
}

/** The open items as they stood at a moment: each item now, with the events since undone, newest first. */
export function rewind(items: Now[], events: Ev[], at: string, closed: Closed): Item[] {
  const after = events.filter((e) => e.ts > at && e.target_id).sort((a, b) => b.seq - a.seq);
  const out: Item[] = [];
  for (const now of items) {
    if (now.created_at > at) continue;
    let { status, title, archived } = now;
    for (const e of after) {
      if (e.target_id !== now.id) continue;
      if (e.action === 'entity.update') {
        const c = e.detail?.changes ?? {};
        if (c.status && 'from' in c.status) status = c.status.from;
        if (c.title && 'from' in c.title) title = c.title.from;
      } else if (e.action === 'entity.archive') archived = false;
      else if (e.action === 'entity.restore') archived = true;
    }
    if (!archived && !closed(now.type).includes(status)) out.push({ id: now.id, type: now.type, title, status, ...(now.body && { body: now.body }) });
  }
  return out;
}

/** The commits a reason or basis names: seven or more hex characters. */
export const shasIn = (text: string | null | undefined): string[] => [...String(text ?? '').matchAll(/\b[0-9a-f]{7,40}\b/g)].map((m) => m[0]);
const names = (commits: string[], text: string | null | undefined) => shasIn(text).some((s) => commits.some((c) => c.startsWith(s)));

export interface ReaderChange {
  /** Proposal id, or the changeset it was applied in. */
  from: string;
  ts: string;
  status: 'approved' | 'rejected' | 'superseded' | 'pending' | 'applied';
  ops: Record<string, any>[];
}

/**
 * The labels one read earned. `changes` are what the reader sent for this push (proposals, and changes applied at
 * once); `later` is the log after them; `open` the items as they stood; `now` every item as it is.
 */
export function readerLabels(changes: ReaderChange[], later: Ev[], open: Item[], now: Map<string, Now>, closed: Closed): Label[] {
  const labels: Label[] = [];
  const titles = open.map((i) => i.title);
  const other = (e: Ev) => e.actor !== 'agent:reader';
  for (const c of changes) {
    const creates = c.ops.filter((o) => o.op === 'create');
    for (const op of c.ops) {
      if (op.op === 'create') {
        const made = c.status === 'applied' ? op.made : undefined;
        const copy = copyOf(String(op.title ?? ''), titles);
        let verdict: Label['verdict'] | undefined;
        let basis = '';
        let weak = false;
        if (copy) (verdict = 'bad'), (basis = `copy of "${copy}"`);
        else if (c.status === 'approved' || c.status === 'superseded') (verdict = 'good'), (basis = c.status);
        else if (c.status === 'rejected') (verdict = 'bad'), (basis = 'rejected');
        else if (c.status === 'applied' && made) {
          const gone = later.find((e) => other(e) && e.ts > c.ts && ((e.target_id === made && e.action === 'entity.archive') || (e.action === 'entity.merge' && e.detail?.absorbed?.id === made)));
          if (gone) (verdict = 'bad'), (basis = gone.action === 'entity.merge' ? 'merged away' : 'archived');
          else if (now.get(made)) (verdict = 'good'), (basis = 'kept'), (weak = true);
        }
        if (verdict) labels.push({ change: 'create', title: String(op.title ?? ''), verdict, basis, ...(weak && { weak }) });
        continue;
      }
      if (op.op === 'archive') {
        const back = later.find((e) => other(e) && e.ts > c.ts && e.target_id === op.id && e.action === 'entity.restore');
        if (c.status === 'applied') labels.push({ change: 'archive', item: op.id, verdict: back ? 'bad' : 'good', basis: back ? 'restored' : 'kept', ...(!back && { weak: true }) });
        else if (c.status !== 'pending') labels.push({ change: 'archive', item: op.id, verdict: c.status === 'rejected' ? 'bad' : 'good', basis: c.status });
        continue;
      }
      if (op.op !== 'update' || !op.id || creates.length) continue;
      const item = now.get(op.id);
      const kind = kindOf(op, closed(item?.type ?? ''));
      if (!kind) continue;
      const base = { change: kind.change, item: op.id, ...(kind.to && { to: kind.to }) };
      if (c.status === 'approved' || c.status === 'superseded') labels.push({ ...base, verdict: 'good', basis: c.status });
      else if (c.status === 'rejected') labels.push({ ...base, verdict: 'bad', basis: 'rejected' });
      else if (c.status === 'applied') {
        // Taken back: someone else set the field back to what it was, or (for a close) reopened it.
        const undone = later.find((e) => {
          if (!other(e) || e.ts <= c.ts || e.target_id !== op.id || e.action !== 'entity.update') return false;
          const ch = e.detail?.changes ?? {};
          // Moved on (doing to done) is not taken back: only a move to another open status is.
          if (kind.change === 'close' || kind.change === 'status') return ch.status && ch.status.from === kind.to && !closed(item?.type ?? '').includes(ch.status.to);
          if (kind.change === 'title') return Boolean(ch.title);
          return false;
        });
        // Confirmed: someone else changed or confirmed the closed item afterwards, so they looked at it, and it is still closed.
        const confirmed =
          !undone &&
          kind.change === 'close' &&
          item !== undefined &&
          closed(item.type).includes(item.status) &&
          later.find((e) => other(e) && e.ts > c.ts && e.target_id === op.id && e.action === 'entity.update');
        if (undone) labels.push({ ...base, verdict: 'bad', basis: 'taken back' });
        else if (confirmed) labels.push({ ...base, verdict: 'good', basis: `confirmed by ${confirmed.actor}` });
        else labels.push({ ...base, verdict: 'good', basis: 'kept', weak: true });
      }
    }
  }
  return labels;
}

/** Closes someone other than the reader made, citing one of these commits, that still stand. */
export function commitCloses(events: Ev[], commits: string[], open: Item[], now: Map<string, Now>, closed: Closed): Label[] {
  const ids = new Set(open.map((i) => i.id));
  const out = new Map<string, Label>();
  for (const e of events) {
    if (e.actor === 'agent:reader' || e.action !== 'entity.update' || !e.target_id || !ids.has(e.target_id)) continue;
    const to = e.detail?.changes?.status?.to;
    const item = now.get(e.target_id);
    if (!to || !item || !closed(item.type).includes(to) || !closed(item.type).includes(item.status)) continue;
    if (!names(commits, `${e.reason ?? ''} ${e.detail?.authority?.basis ?? ''} ${e.detail?.source ?? ''}`)) continue;
    out.set(e.target_id, { change: 'close', item: e.target_id, to, verdict: 'good', basis: 'closed citing a commit of the push' });
  }
  return [...out.values()];
}

/** One label per change: a strong one wins over a weak one, and a bad one over a good one of the same strength. */
export function settle(labels: Label[]): Label[] {
  const key = (l: Label) => (l.change === 'create' ? `create:${l.title}` : `${l.change}:${l.item}:${l.change === 'status' ? l.to : ''}`);
  const rank = (l: Label) => (l.weak ? 0 : 2) + (l.verdict === 'bad' ? 1 : 0);
  const kept = new Map<string, Label>();
  for (const l of labels) {
    const had = kept.get(key(l));
    if (!had || rank(l) > rank(had)) kept.set(key(l), l);
  }
  return [...kept.values()];
}
