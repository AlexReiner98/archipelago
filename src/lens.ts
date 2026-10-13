// A lens says what is in a picture, and is answered with data of one fixed
// shape: the lens as it was read, items, links, and what was left out. How
// that data looks (a shape, colours, what is lit) is a style, chosen where it
// is drawn; nothing here knows about it. A thing with parts carries the same
// keys as a thing without, so one drawing can serve at every scale.

import type { Archipelago } from './pelago.ts';
import { blockGraph } from './views.ts';

export interface Lens {
  /** Where it starts: one item. Without it, the whole map. */
  from?: string;
  /** Which types are in it: a type (flavours included) or "work"; with a leading "-", left out. */
  kinds?: string[];
  /** The one kind of link that says what is inside what. */
  by: string;
  /** The kinds of link sent along as links, or "all". */
  over: string[] | 'all';
  /** How many steps down from the start, or from what is inside nothing. */
  far?: number;
  /** What each item is filed under. */
  lanes?: 'stage' | 'link' | 'person';
  /** The number field that orders the things beside each other. */
  order: string;
  /** What size counts. */
  measure: 'work' | 'tokens';
  /** What is left out until asked for. */
  fold: string[];
}

export const LENS_DEFAULT: Lens = { by: 'part_of', over: ['depends_on', 'waits_on'], order: 'order', measure: 'work', fold: ['closed', 'system', 'unlinked'] };
const FOLDS = ['closed', 'system', 'unlinked'];
const LANES = ['stage', 'link', 'person'];
/** The most items one answer sends: the deepest are cut first, and `rest` says how many. */
export const LENS_LIMIT = 2000;
/** Statuses that mean someone is on it now. */
const UNDER_WAY = ['doing', 'building', 'investigating'];

interface Row {
  id: string;
  type: string;
  title: string;
  status: string;
  is_open: boolean;
  owner: string | null;
  props: Record<string, unknown>;
  created_at: Date;
}

interface Counts {
  items: number;
  work: number;
  blocked: number;
  waiting: number;
  sessions: number;
  tokens: { estimated: number; used: number };
  /** How many of them wait on each person. */
  waits_on: Record<string, number>;
  /** How many of them are not among the items of this answer. */
  not_sent: number;
}

/** The lens asked for, over the built-in one: a field that is named replaces it whole. */
function read(l: Archipelago, input: Record<string, unknown>): Lens {
  const lens: Lens = { ...LENS_DEFAULT };
  const known = (kind: unknown, field: string) => {
    if (typeof kind !== 'string' || !l.registry.relations.has(kind)) throw new Error(`${field}: unknown kind of link "${kind}". Known: ${[...l.registry.relations.keys()].join(', ')}`);
    return kind;
  };
  const list = (value: unknown, field: string): string[] => {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new Error(`${field} must be a list of names`);
    return value as string[];
  };
  if (input.from !== undefined) lens.from = String(input.from);
  if (input.kinds !== undefined) lens.kinds = list(input.kinds, 'kinds');
  if (input.by !== undefined) lens.by = known(input.by, 'by');
  if (input.over !== undefined) lens.over = input.over === 'all' ? 'all' : list(input.over, 'over').map((kind) => known(kind, 'over'));
  if (input.far !== undefined) {
    if (!Number.isInteger(input.far) || (input.far as number) < 0 || (input.far as number) > 12) throw new Error('far must be a whole number from 0 to 12');
    lens.far = input.far as number;
  }
  if (input.lanes !== undefined) {
    if (!LANES.includes(input.lanes as string)) throw new Error(`lanes must be one of: ${LANES.join(', ')}`);
    lens.lanes = input.lanes as Lens['lanes'];
  }
  if (input.order !== undefined) lens.order = String(input.order);
  if (input.measure !== undefined) {
    if (input.measure !== 'work' && input.measure !== 'tokens') throw new Error('measure must be one of: work, tokens');
    lens.measure = input.measure;
  }
  if (input.fold !== undefined) {
    lens.fold = list(input.fold, 'fold');
    const unknown = lens.fold.filter((f) => !FOLDS.includes(f));
    if (unknown.length) throw new Error(`fold must be of: ${FOLDS.join(', ')}; not ${unknown.join(', ')}`);
  }
  return lens;
}

/** What a lens answers with: the lens as read, the items, the links between them, and what was left out. */
export async function lens(l: Archipelago, input: Record<string, unknown>) {
  const asked = read(l, input);
  const { rows: entities } = await l.db.query<Row>(`select id, type, title, status, is_open, owner, ${l.props}, created_at from entity where archived_at is null`);
  const all = new Map(entities.map((e) => [e.id, e]));
  if (asked.from && !all.has(asked.from)) throw new Error(`No entity "${asked.from}"`);
  const { rows: relations } = await l.db.query<{ id: string; type: string; from_id: string; to_id: string }>(`select id, type, from_id, to_id from relation where valid_to is null order by id`);

  const isA = (type: string, kind: string) => l.registry.isA(type, kind);
  const system = (type: string) => type.startsWith('sys.') && !isA(type, 'resource');
  // What is work: what can be estimated, and what such things are part of.
  const work = (type: string) => Boolean(l.registry.type(type)?.fields.tokens_estimated) || isA(type, 'project');
  const wanted = (asked.kinds ?? []).filter((k) => !k.startsWith('-'));
  const unwanted = (asked.kinds ?? []).filter((k) => k.startsWith('-')).map((k) => k.slice(1));
  const is = (type: string, kind: string) => (kind === 'work' ? work(type) : isA(type, kind));
  const rest = { closed: 0, system: 0, kinds: 0, unlinked: 0, far: 0, limit: 0 };

  const eligible = new Map<string, Row>();
  for (const e of entities) {
    if (e.id === asked.from) eligible.set(e.id, e);
    else if (asked.fold.includes('system') && system(e.type)) rest.system++;
    else if (asked.fold.includes('closed') && !e.is_open) rest.closed++;
    else if ((wanted.length && !wanted.some((k) => is(e.type, k))) || unwanted.some((k) => is(e.type, k))) rest.kinds++;
    else eligible.set(e.id, e);
  }
  const live = relations.filter((r) => eligible.has(r.from_id) && eligible.has(r.to_id));

  // What a thing is inside: where its organising link leads. Led to two things (a task of a feature, linked
  // to the project as well), it is inside the nearer: the one that is itself inside something.
  const leads = new Map<string, string[]>();
  for (const r of live) if (r.type === asked.by && r.from_id !== r.to_id) leads.set(r.from_id, [...(leads.get(r.from_id) ?? []), r.to_id]);
  const parent = new Map<string, string>();
  for (const [id, to] of leads) parent.set(id, to.find((p) => leads.has(p)) ?? to[0]);
  // A loop of belonging is cut where it closes, so everything has a depth.
  const depths = new Map<string, number>();
  const depth = (id: string, trail = new Set<string>()): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    const up = parent.get(id);
    if (up === undefined || id === asked.from) return depths.set(id, 0), 0;
    if (trail.has(up)) return parent.delete(id), depths.set(id, 0), 0;
    trail.add(id);
    const d = depth(up, trail) + 1;
    depths.set(id, d);
    return d;
  };
  for (const id of eligible.keys()) depth(id);
  const kids = new Map<string, string[]>();
  for (const [id, up] of parent) kids.set(up, [...(kids.get(up) ?? []), id]);

  // Which of them are sent.
  const along = (type: string) => asked.over === 'all' || asked.over.includes(type);
  let sent = new Set<string>();
  if (asked.from) {
    // Down from the start, as far as asked; then whatever a link that is sent along ties to one of those.
    const reach = (id: string, steps: number) => {
      sent.add(id);
      for (const kid of kids.get(id) ?? []) {
        if (sent.has(kid)) continue;
        if (asked.far !== undefined && steps >= asked.far) rest.far++;
        else reach(kid, steps + 1);
      }
    };
    reach(asked.from, 0);
    const tree = new Set(sent);
    for (const r of live) {
      if (!along(r.type)) continue;
      if (tree.has(r.from_id)) sent.add(r.to_id);
      // Not what is inside one of them, though: that is what `far` cut.
      if (tree.has(r.to_id) && r.type !== asked.by) sent.add(r.from_id);
    }
  } else {
    for (const id of eligible.keys()) {
      if (asked.fold.includes('unlinked') && !parent.has(id) && !kids.has(id)) rest.unlinked++;
      else if (asked.far !== undefined && depths.get(id)! > asked.far) rest.far++;
      else sent.add(id);
    }
  }
  if (sent.size > LENS_LIMIT) {
    const kept = [...sent].sort((a, b) => depths.get(a)! - depths.get(b)!).slice(0, LENS_LIMIT);
    rest.limit = sent.size - kept.length;
    sent = new Set(kept);
  }

  // The state of each thing, and the same counted over everything inside it, sent or not.
  const blocked = await blockGraph(l);
  const { rows: at } = await l.db.query<{ target: string }>(
    `select r.to_id as target from relation r join entity s on s.id = r.from_id
     where r.type = 'sys.works_on' and r.valid_to is null and s.is_open and s.archived_at is null`,
  );
  const sessions = new Map<string, number>();
  for (const { target } of at) sessions.set(target, (sessions.get(target) ?? 0) + 1);
  const state = (e: Row) => ({
    blocked: blocked.isBlocked(e.id),
    waits_on: (blocked.direct.get(e.id) ?? []).filter((edge) => edge.why === 'waits_on').map((edge) => edge.y),
    sessions: sessions.get(e.id) ?? 0,
  });
  const size = (e: Row) => ({ work: work(e.type) && e.is_open ? 1 : 0, tokens: { estimated: Number(e.props.tokens_estimated ?? 0), used: Number(e.props.tokens_used ?? 0) } });
  const totals = new Map<string, Counts>();
  const within = (id: string): Counts => {
    const known = totals.get(id);
    if (known) return known;
    const sum: Counts = { items: 0, work: 0, blocked: 0, waiting: 0, sessions: 0, tokens: { estimated: 0, used: 0 }, waits_on: {}, not_sent: 0 };
    totals.set(id, sum);
    for (const kid of kids.get(id) ?? []) {
      const e = eligible.get(kid)!;
      const [own, big, inner] = [state(e), size(e), within(kid)];
      sum.items += 1 + inner.items;
      sum.work += big.work + inner.work;
      sum.blocked += (own.blocked ? 1 : 0) + inner.blocked;
      sum.waiting += (own.waits_on.length ? 1 : 0) + inner.waiting;
      sum.sessions += own.sessions + inner.sessions;
      sum.tokens.estimated += big.tokens.estimated + inner.tokens.estimated;
      sum.tokens.used += big.tokens.used + inner.tokens.used;
      for (const who of own.waits_on) sum.waits_on[who] = (sum.waits_on[who] ?? 0) + 1;
      for (const [who, n] of Object.entries(inner.waits_on)) sum.waits_on[who] = (sum.waits_on[who] ?? 0) + n;
      sum.not_sent += (sent.has(kid) ? 0 : 1) + inner.not_sent;
    }
    return sum;
  };

  // Its place among the things beside it: by the ordering field where it has one, then as they were written down.
  const inside = (id: string) => (parent.has(id) && sent.has(parent.get(id)!) ? parent.get(id)! : null);
  const beside = new Map<string, Row[]>();
  for (const id of sent) beside.set(inside(id) ?? '', [...(beside.get(inside(id) ?? '') ?? []), eligible.get(id)!]);
  const place = new Map<string, number>();
  const ordered = (e: Row) => (typeof e.props[asked.order] === 'number' ? (e.props[asked.order] as number) : Infinity);
  for (const group of beside.values()) {
    group.sort((a, b) => ordered(a) - ordered(b) || +new Date(a.created_at) - +new Date(b.created_at) || a.title.localeCompare(b.title));
    group.forEach((e, i) => place.set(e.id, i + 1));
  }

  // What it is filed under, when the lens has lanes.
  const tied = new Map<string, string>();
  if (asked.lanes === 'link' && asked.from) for (const r of live) for (const [a, b] of [[r.from_id, r.to_id], [r.to_id, r.from_id]]) if (a === asked.from && !tied.has(b)) tied.set(b, r.type);
  const lane = (e: Row): string | null => {
    if (asked.lanes === 'person') return e.owner;
    if (asked.lanes === 'link') return tied.get(e.id) ?? null;
    if (!e.is_open) return 'done';
    return (sessions.get(e.id) ?? 0) > 0 || Number(e.props.tokens_used ?? 0) > 0 || UNDER_WAY.includes(e.status) ? 'under_way' : 'to_come';
  };

  // A link whose end was not sent is moved up to the nearest thing that was, so one line can stand for several.
  const lift = (id: string): string | undefined => {
    for (let cur: string | undefined = id, steps = 0; cur !== undefined && steps < 64; cur = parent.get(cur), steps++) if (sent.has(cur)) return cur;
    return undefined;
  };
  const lines = new Map<string, { kind: string; from: string; to: string; n: number }>();
  for (const r of live) {
    if (!along(r.type)) continue;
    const [from, to] = [lift(r.from_id), lift(r.to_id)];
    if (!from || !to || from === to) continue;
    // What is inside what is already said by `inside`.
    if (r.type === asked.by && inside(from) === to) continue;
    const key = `${r.type} ${from} ${to}`;
    const line = lines.get(key) ?? { kind: r.type, from, to, n: 0 };
    line.n++;
    lines.set(key, line);
  }

  return {
    lens: asked,
    items: [...sent].map((id) => {
      const e = eligible.get(id)!;
      return {
        id,
        type: e.type,
        root: l.registry.type(e.type)?.lineage.at(-1) ?? e.type,
        title: e.title,
        status: e.status,
        open: e.is_open,
        inside: inside(id),
        place: place.get(id)!,
        ...(asked.lanes && { lane: lane(e) }),
        size: size(e),
        state: state(e),
        within: within(id),
      };
    }),
    links: [...lines.values()],
    rest,
  };
}
