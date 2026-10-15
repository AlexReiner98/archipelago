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
  /** Or the story a session told (a run): what its standing beats are about, with the ties it drew. */
  story?: string;
  /** With story: one beat only (its number), as its finding is drawn. */
  beat?: number;
  /** Which types are in it: a type (flavours included) or "work"; with a leading "-", left out. */
  kinds?: string[];
  /** The one kind of link that says what is inside what. */
  by: string;
  /** The kinds of link sent along as links, or "all". */
  over: string[] | 'all';
  /** How many steps down from the start, or from what is inside nothing. */
  far?: number;
  /** What each item is filed under: its stage of work, its link to the start, its owner, or the value of one of its fields (field:<name>). */
  lanes?: 'stage' | 'link' | 'person' | `field:${string}`;
  /** The number field that orders the things beside each other. */
  order: string;
  /** What size counts. */
  measure: 'work' | 'tokens';
  /** What is left out until asked for. */
  fold: string[];
}

export const LENS_DEFAULT: Lens = { by: 'part_of', over: ['depends_on', 'waits_on'], order: 'order', measure: 'work', fold: ['closed', 'system', 'unlinked'] };
/** The fields a lens kept on the map may name: all but where it starts, which is what it is about. */
const LENS_KEPT = { kinds: 1, by: 1, over: 1, far: 1, lanes: 1, order: 1, measure: 1, fold: 1 };
/** What a view may let the person looking change on the page. */
const CONTROLS = ['lit', 'far', 'closed'];
const FOLDS = ['closed', 'system', 'unlinked'];
const LANES = ['stage', 'link', 'person'];
/** The most items one answer sends: the deepest are cut first, and `rest` says how many. */
export const LENS_LIMIT = 2000;
/** The kinds of link that say one thing cannot move until another has. */
const WAITS = ['depends_on', 'waits_on', 'needs'];
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
export function readLens(l: Archipelago, input: Record<string, unknown>, under: Lens = LENS_DEFAULT): Lens {
  const lens: Lens = { ...under };
  const known = (kind: unknown, field: string) => {
    if (typeof kind !== 'string' || !l.registry.relations.has(kind)) throw new Error(`${field}: unknown kind of link "${kind}". Known: ${[...l.registry.relations.keys()].join(', ')}`);
    return kind;
  };
  const list = (value: unknown, field: string): string[] => {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw new Error(`${field} must be a list of names`);
    return value as string[];
  };
  if (input.from !== undefined) lens.from = String(input.from);
  if (input.story !== undefined) lens.story = String(input.story);
  if (input.beat !== undefined) {
    if (!Number.isInteger(input.beat) || (input.beat as number) < 1) throw new Error('beat must be the number of a beat, from 1');
    lens.beat = input.beat as number;
  }
  if (input.kinds !== undefined) lens.kinds = list(input.kinds, 'kinds');
  if (input.by !== undefined) lens.by = known(input.by, 'by');
  if (input.over !== undefined) lens.over = input.over === 'all' ? 'all' : list(input.over, 'over').map((kind) => known(kind, 'over'));
  if (input.far !== undefined) {
    if (!Number.isInteger(input.far) || (input.far as number) < 0 || (input.far as number) > 12) throw new Error('far must be a whole number from 0 to 12');
    lens.far = input.far as number;
  }
  if (input.lanes !== undefined) {
    const lanes = String(input.lanes);
    const field = /^field:([a-z][a-z0-9_]*)$/.exec(lanes)?.[1];
    if (field !== undefined && ![...l.registry.types.values()].some((t) => t.fields[field])) throw new Error(`lanes: no type has a field "${field}"`);
    if (field === undefined && !LANES.includes(lanes)) throw new Error(`lanes must be one of: ${LANES.join(', ')}, or field:<name>`);
    lens.lanes = lanes as Lens['lanes'];
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

/** The view every item has: what it is tied to, by kind of link. Asked for by this name in place of a lens's id. */
export const AROUND = 'around';

interface Kept {
  id: string;
  title: string;
  props: Record<string, unknown>;
  about: string[];
}

/** Every lens or style kept on the map, with what each is about; and one named outright, retired or not. */
async function keptOf(l: Archipelago, type: 'lens' | 'style', named: unknown): Promise<Kept[]> {
  const { rows } = await l.db.query<{ id: string; title: string; props: Record<string, unknown> }>(
    `select id, title, ${l.props} from entity where type = any($1::text[]) and archived_at is null and (is_open or id = $2) order by updated_at, id`,
    [l.registry.family(type), typeof named === 'string' ? named : null],
  );
  if (typeof named === 'string' && !rows.some((r) => r.id === named)) throw new Error(`No ${type} "${named}"`);
  const { rows: links } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'about' and valid_to is null and from_id = any($1::text[])`, [rows.map((r) => r.id)]);
  return rows.map((r) => ({ ...r, about: links.filter((link) => link.from_id === r.id).map((link) => link.to_id) }));
}

/** A lens in words, so a person and an agent read the same rule: what is in the picture and what is not. */
function sayLens(l: Archipelago, asked: Lens, startTitle: string | undefined): string {
  const link = (kind: string) => l.registry.relations.get(kind)?.title ?? kind;
  const parts = [asked.story ? `What "${startTitle}" told of, with the ties it drew` : startTitle ? `"${startTitle}" and what ${link(asked.by)} it` : `Everything, by what ${link(asked.by)} what`];
  if (asked.far !== undefined) parts.push(asked.far === 0 ? 'nothing below it' : `${asked.far} step${asked.far === 1 ? '' : 's'} down`);
  if (asked.kinds?.length) parts.push(`only ${asked.kinds.map((k) => (k.startsWith('-') ? `not ${k.slice(1)}` : k)).join(', ')}`);
  parts.push(asked.over === 'all' ? 'with every kind of link' : asked.over.length ? `with links: ${asked.over.map(link).join(', ')}` : 'with no links');
  if (asked.lanes) parts.push(`filed by ${asked.lanes.startsWith('field:') ? `its ${asked.lanes.slice(6).replaceAll('_', ' ')}` : asked.lanes}`);
  const out = asked.fold.map((f) => ({ closed: 'what is finished', system: 'the system\u2019s own records', unlinked: 'what is linked to nothing this way' })[f] ?? f);
  parts.push(out.length ? `without ${out.join(', ')}` : 'with nothing left out');
  return parts.join('; ') + '.';
}

/** How many open things an item holds before it is a hub, unless its project says otherwise (hub_at). */
export const HUB_AT = 12;

/**
 * The hubs: open items that hold enough to need views of their own. How much
 * is enough is the nearest project's hub_at, or HUB_AT: a project still being
 * shaped sets it low, so that most of what is in it is treated as a hub.
 * Read off the map each time; nothing says an item is a hub that could go stale.
 */
export async function hubs(l: Archipelago) {
  const { rows: entities } = await l.db.query<{ id: string; type: string; title: string; props: Record<string, unknown> }>(`select id, type, title, ${l.props} from entity where archived_at is null and is_open`);
  const byId = new Map(entities.filter((e) => !e.type.startsWith('sys.') && !l.registry.isA(e.type, 'lens') && !l.registry.isA(e.type, 'style')).map((e) => [e.id, e]));
  const { rows: parts } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'part_of' and valid_to is null order by id`);
  const up = new Map<string, string>();
  const kids = new Map<string, string[]>();
  for (const p of parts) {
    if (!byId.has(p.from_id) || !byId.has(p.to_id) || up.has(p.from_id) || p.from_id === p.to_id) continue;
    up.set(p.from_id, p.to_id);
    kids.set(p.to_id, [...(kids.get(p.to_id) ?? []), p.from_id]);
  }
  const counts = new Map<string, number>();
  const inside = (id: string, trail = new Set<string>()): number => {
    const known = counts.get(id);
    if (known !== undefined) return known;
    if (trail.has(id)) return 0; // a loop of belonging: stop going round
    trail.add(id);
    const n = (kids.get(id) ?? []).reduce((sum, kid) => sum + 1 + inside(kid, trail), 0);
    trail.delete(id);
    counts.set(id, n);
    return n;
  };
  const at = (id: string): number => {
    for (let cur: string | undefined = id, steps = 0; cur !== undefined && steps < 64; cur = up.get(cur), steps++) {
      const e = byId.get(cur)!;
      if (l.registry.isA(e.type, 'project') && typeof e.props.hub_at === 'number') return e.props.hub_at;
    }
    return HUB_AT;
  };
  const views = new Map<string, number>();
  for (const lens of await keptOf(l, 'lens', undefined)) for (const id of lens.about) views.set(id, (views.get(id) ?? 0) + 1);
  return [...byId.values()]
    .map((e) => ({ id: e.id, type: e.type, title: e.title, inside: inside(e.id), at: at(e.id), views: views.get(e.id) ?? 0 }))
    .filter((h) => h.inside > 0 && h.inside >= h.at)
    .sort((a, b) => b.inside - a.inside || a.title.localeCompare(b.title));
}

/** Where on the page a lens or a style is seen at work: the picture of what it is about, or of the whole map. Nothing for any other item. */
export async function pictureOf(l: Archipelago, id: string): Promise<string | undefined> {
  const item = await l.entity(id);
  if (!item || !(l.registry.isA(item.type, 'lens') || l.registry.isA(item.type, 'style'))) return undefined;
  const { rows } = await l.db.query<{ to_id: string }>(`select to_id from relation where type = 'about' and from_id = $1 and valid_to is null order by id limit 1`, [id]);
  return rows.length ? `graph?from=${rows[0].to_id}` : 'graph?lens';
}

/** A beat of a session's story, as the tell tool keeps it on the run. */
interface Beat {
  n: number;
  about: string[];
  links: { from: string; to: string; says: string }[];
  replaced_by?: number;
}

/** The story a run told: the run, and its beats that stand (not taken back). By its id or by the id its surface gave it. */
async function storyOf(l: Archipelago, key: string): Promise<{ id: string; title: string; beats: Beat[] }> {
  const { rows } = await l.db.query<{ id: string; title: string; story: unknown }>(
    `select id, title, props->'story' as story from entity where type = any($1::text[]) and archived_at is null and (id = $2 or props->>'session_id' = $2) order by is_open desc, created_at desc limit 1`,
    [l.registry.family('sys.run'), key],
  );
  if (!rows.length) throw new Error(`No session "${key}" to draw the story of`);
  const beats = Array.isArray(rows[0].story) ? (rows[0].story as Beat[]) : [];
  return { id: rows[0].id, title: rows[0].title, beats: beats.filter((b) => !b.replaced_by) };
}

/** What a lens answers with: the lens as read, the items, the links between them, and what was left out. */
export async function lens(l: Archipelago, input: Record<string, unknown>) {
  // A story is drawn under no view of its own: the workspace's views are pictures of the map, not of what a session said.
  const told = input.story === undefined ? undefined : await storyOf(l, String(input.story));
  // One beat of it, where one is asked for: a finding is drawn alone.
  if (told && input.beat !== undefined) {
    const one = told.beats.find((b) => b.n === input.beat);
    if (!one) throw new Error(`No beat ${input.beat} stands in the story of "${told.title}"`);
    told.beats = [one];
  }
  // The item the picture is asked for. Each lens kept about it is a view of it, with a name; the first in order is the one it opens on.
  const hub = input.from === undefined ? undefined : String(input.from);
  // Around one item there is always the picture of what it is tied to, by kind of link: what it waits on and what waits on it.
  const around = hub !== undefined && input.lens === AROUND;
  const [lenses, styles] = [await keptOf(l, 'lens', around ? undefined : input.lens), await keptOf(l, 'style', input.style)];
  const placed = (one: Kept) => (typeof one.props.place === 'number' ? one.props.place : Infinity);
  // Every lens that applies can be chosen: those about the item, then what it is tied to, then the workspace's own (about nothing), each in its order.
  const own = hub === undefined ? [] : lenses.filter((one) => one.about.includes(hub)).sort((a, b) => placed(a) - placed(b));
  const shared = lenses.filter((one) => !one.about.length).sort((a, b) => placed(a) - placed(b));
  const views = told ? [] : [...own, ...(hub === undefined ? [] : [{ id: AROUND, title: 'Around it', props: {}, about: [] }]), ...shared];
  // An item opens on its first picture of its own (not a shortcut, which leads away), else on what it is tied to; the whole map on the workspace's first.
  const view = around || (told && typeof input.lens !== 'string') ? undefined : typeof input.lens === 'string' ? lenses.find((one) => one.id === input.lens) : hub === undefined ? shared[0] : own.find((one) => typeof one.props.from !== 'string');
  // A view may start somewhere else than the item it is kept about: tightly scoped, that is a shortcut.
  // Asked for by its id alone, a view kept about one item starts from that item, so it can be drawn anywhere: in a document, for one.
  const start = typeof view?.props.from === 'string' ? view.props.from : (hub ?? (view && view.about.length === 1 ? view.about[0] : undefined));
  // Around one item the picture is its neighbourhood: every kind of link, each neighbour filed under the link that ties it.
  // A story's items are tied by whatever the map ties them by, and what is finished stays: it was told of.
  let under: Lens = told ? { ...LENS_DEFAULT, over: 'all', fold: ['system'] } : start === undefined ? LENS_DEFAULT : { ...LENS_DEFAULT, over: 'all', lanes: 'link' };
  // One view at a time, over what is built in: a field it does not name is the built-in one.
  const read = view ? [view] : [];
  for (const one of read) {
    try {
      under = readLens(l, Object.fromEntries(Object.entries(one.props).filter(([key, value]) => key in LENS_KEPT && value != null)), under);
    } catch (err) {
      throw new Error(`The lens "${one.title}" cannot be read: ${(err as Error).message}`);
    }
  }
  const asked = readLens(l, { ...input, ...(start !== undefined && { from: start }), ...(told && { story: told.id, from: undefined }) }, under);
  // What the story is about, in the order it came to them; and for each, the beats that are about it.
  const about = told ? [...new Set(told.beats.flatMap((b) => b.about))] : [];
  const beatsOf = (id: string) => (told ? told.beats.filter((b) => b.about.includes(id)).map((b) => b.n) : []);
  // A style is passed on as it is kept: only the page that draws reads it. The workspace's, then the item's, then this view's, then one named.
  const weight = (one: Kept) => (one.id === input.style ? 3 : view && one.about.includes(view.id) ? 2 : hub !== undefined && one.about.includes(hub) ? 1 : one.about.length ? -1 : 0);
  const drawn = styles.filter((one) => weight(one) >= 0).sort((a, b) => weight(a) - weight(b));
  const style: Record<string, unknown> = {};
  for (const one of drawn) for (const [key, value] of Object.entries(one.props)) if (value != null) style[key] = value;
  const { rows: entities } = await l.db.query<Row>(`select id, type, title, status, is_open, owner, ${l.props}, created_at from entity where archived_at is null`);
  const all = new Map(entities.map((e) => [e.id, e]));
  if (asked.from && !all.has(asked.from)) throw new Error(`No entity "${asked.from}"`);
  const { rows: relations } = await l.db.query<{ id: string; type: string; from_id: string; to_id: string; says: string | null }>(
    `select id, type, from_id, to_id, props ->> 'says' as says from relation where valid_to is null order by id`,
  );

  const isA = (type: string, kind: string) => l.registry.isA(type, kind);
  // A lens and a style are how the map is looked at, not part of what is seen.
  const system = (type: string) => (type.startsWith('sys.') && !isA(type, 'resource')) || isA(type, 'lens') || isA(type, 'style');
  // What is work: what can be estimated, and what such things are part of.
  const work = (type: string) => Boolean(l.registry.type(type)?.fields.tokens_estimated) || isA(type, 'project');
  const wanted = (asked.kinds ?? []).filter((k) => !k.startsWith('-'));
  const unwanted = (asked.kinds ?? []).filter((k) => k.startsWith('-')).map((k) => k.slice(1));
  const is = (type: string, kind: string) => (kind === 'work' ? work(type) : isA(type, kind));
  const rest = { closed: 0, system: 0, kinds: 0, unlinked: 0, far: 0, limit: 0 };

  const eligible = new Map<string, Row>();
  // What stands on the map for this picture before kinds are chosen: the ladder a thing is found on when what holds it is not of the kinds kept.
  const standing = new Set<string>();
  for (const e of entities) {
    if (e.id === asked.from || about.includes(e.id)) (eligible.set(e.id, e), standing.add(e.id));
    else if (asked.fold.includes('system') && system(e.type)) rest.system++;
    else if (asked.fold.includes('closed') && !e.is_open) rest.closed++;
    else if ((wanted.length && !wanted.some((k) => is(e.type, k))) || unwanted.some((k) => is(e.type, k))) (rest.kinds++, standing.add(e.id));
    else (eligible.set(e.id, e), standing.add(e.id));
  }
  const live = relations.filter((r) => eligible.has(r.from_id) && eligible.has(r.to_id));

  // What a thing is inside: where its organising link leads. Led to two things (a task of a feature, linked
  // to the project as well), it is inside the nearer: the one that is itself inside something.
  const leads = new Map<string, string[]>();
  for (const r of relations) if (r.type === asked.by && r.from_id !== r.to_id && standing.has(r.from_id) && standing.has(r.to_id)) leads.set(r.from_id, [...(leads.get(r.from_id) ?? []), r.to_id]);
  const parent = new Map<string, string>();
  const holder = (id: string) => leads.get(id)?.find((p) => leads.has(p)) ?? leads.get(id)?.[0];
  for (const id of eligible.keys()) {
    // Up past what is not of the kinds kept, to the nearest thing that is.
    let up = holder(id);
    for (let steps = 0; up !== undefined && !eligible.has(up) && steps < 64; steps++) up = holder(up);
    if (up !== undefined && up !== id && eligible.has(up)) parent.set(id, up);
  }
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
  if (told) {
    // Only what the story is about: it is what the session chose to show.
    for (const id of about) if (eligible.has(id)) sent.add(id);
  } else if (asked.from) {
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
    // Brought in: whatever a link ties to the start itself, and what blocks or is blocked by anything inside it.
    // Not every neighbour of everything inside: a project's picture is not its whole surroundings.
    for (const r of live) {
      if (!along(r.type) || !(r.from_id === asked.from || r.to_id === asked.from || WAITS.includes(r.type))) continue;
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
  // The kind of link, and which way it runs: "depends_on" where the start depends on it, "depends_on:in" where it depends on the start.
  if (asked.lanes === 'link' && asked.from) for (const r of live) for (const [a, b, way] of [[r.from_id, r.to_id, ''], [r.to_id, r.from_id, ':in']]) if (a === asked.from && !tied.has(b)) tied.set(b, r.type + way);
  const byField = asked.lanes?.startsWith('field:') ? asked.lanes.slice(6) : undefined;
  const lane = (e: Row): string | null => {
    if (byField !== undefined) return e.props[byField] == null ? null : String(e.props[byField]);
    if (asked.lanes === 'person') return e.owner;
    if (asked.lanes === 'link') return tied.get(e.id) ?? null;
    if (!e.is_open) return 'done';
    return (sessions.get(e.id) ?? 0) > 0 || Number(e.props.tokens_used ?? 0) > 0 || UNDER_WAY.includes(e.status) ? 'under_way' : 'to_come';
  };

  // The fields a type's pack marks as shown travel with the item, so a style can draw by them.
  const shownFields = (e: Row) => {
    const defs = l.registry.type(e.type)?.fields ?? {};
    const fields = Object.fromEntries(Object.entries(e.props).filter(([key, value]) => defs[key]?.shown && value != null));
    return Object.keys(fields).length ? { fields } : {};
  };
  // Filed by a field that has a set of values, the lanes come in that order: the first type that declares them says it.
  const laneOrder = byField === undefined ? undefined : [...l.registry.types.values()].find((t) => t.fields[byField]?.values)?.fields[byField].values;

  // A link whose end was not sent is moved up to the nearest thing that was, so one line can stand for several.
  const lift = (id: string): string | undefined => {
    for (let cur: string | undefined = id, steps = 0; cur !== undefined && steps < 64; cur = parent.get(cur), steps++) if (sent.has(cur)) return cur;
    return undefined;
  };
  const lines = new Map<string, { kind: string; from: string; to: string; n: number; says?: string; beat?: number }>();
  // The ties the session drew are links of their own kind, each with its words and the beat that said it.
  if (told)
    for (const b of told.beats)
      for (const k of b.links) if (sent.has(k.from) && sent.has(k.to)) lines.set(`said ${k.from} ${k.to} ${k.says}`, { kind: 'said', from: k.from, to: k.to, n: 1, says: k.says, beat: b.n });
  // Between two things a session tied, its words say what the map's own link would.
  const tiedBySession = new Set([...lines.values()].flatMap((k) => [`${k.from} ${k.to}`, `${k.to} ${k.from}`]));
  for (const r of live) {
    if (!along(r.type)) continue;
    const [from, to] = [lift(r.from_id), lift(r.to_id)];
    if (!from || !to || from === to || tiedBySession.has(`${from} ${to}`)) continue;
    // What is inside what is already said by `inside`.
    if (r.type === asked.by && inside(from) === to) continue;
    const key = `${r.type} ${from} ${to}`;
    const line = lines.get(key) ?? { kind: r.type, from, to, n: 0, ...(r.says && { says: r.says }) };
    // A line that stands for several links says something only when they all say the same.
    if (line.n > 0 && line.says !== (r.says ?? undefined)) delete line.says;
    line.n++;
    lines.set(key, line);
  }

  return {
    lens: asked,
    style,
    // Which lenses and styles kept on the map went into those two, the one that weighs most last.
    kept: { lens: read.map(({ id, title }) => ({ id, title })), style: drawn.map(({ id, title }) => ({ id, title })) },
    // The lens in words: the rule a person reads on the page and an agent reads here.
    said: sayLens(l, asked, told ? told.title : asked.from ? all.get(asked.from)?.title : undefined),
    // The lenses that can be chosen for this picture, in order, and which this is. One that starts somewhere else is a shortcut to there.
    views: views.map((one) => ({ id: one.id, title: one.title, ...(typeof one.props.from === 'string' && one.props.from !== hub && { to: { id: one.props.from, title: all.get(one.props.from)?.title ?? one.props.from } }) })),
    view: view?.id ?? (hub !== undefined ? AROUND : null),
    ...(hub !== undefined && {
      views_of_it: own.length,
      hub: await (async () => {
        const known = (await hubs(l)).find((h) => h.id === hub);
        return known ? { is: true, inside: known.inside, at: known.at } : { is: false };
      })(),
    }),
    // What the person looking may change on the page, where the view says.
    // A story is what the session chose to show: there is nothing to light by but what it says.
    controls: told ? [] : Array.isArray(view?.props.controls) ? (view!.props.controls as unknown[]).filter((c) => CONTROLS.includes(c as string)) : ['lit'],
    // Who it was answered for, so a style can light what waits on them.
    viewer: l.viewer || (await l.setting<string>('me')) || null,
    items: [...sent].sort((a, b) => (told ? about.indexOf(a) - about.indexOf(b) : 0)).map((id) => {
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
        ...shownFields(e),
        size: size(e),
        state: state(e),
        within: within(id),
        // In a story: the beats that are about it.
        ...(told && { told: beatsOf(id) }),
      };
    }),
    links: [...lines.values()],
    ...(laneOrder && { lanes: laneOrder }),
    rest,
  };
}
