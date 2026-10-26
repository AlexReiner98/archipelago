// Attention: the one standing question the kernel answers. What deserves attention, and why: for a person or for
// everyone, within a scope or across the map. Every reason is read from the root relations and the capabilities, so
// no way of working is named here: what waits on someone (waits_on), what holds others up and what is blocked
// (depends_on, waits_on, needs), what is due (bound), what is unsettled (settles), what nobody has touched, what is
// under way (a session on it), what is ready to take up, and what an agent settled that the owner has not confirmed.
// A pack adds reasons of its own as data (a view of form "attention"): items of a type whose fields hold some values.

import { pastBounds } from './bounds.ts';
import { BlockGraph, blockGraph, heldResources } from './blocking.ts';
import { toConfirm } from './confirm.ts';
import { parts } from './manifest.ts';
import type { Archipelago } from './pelago.ts';
import { SYSTEM } from './head.ts';
import { scopeOf } from './places.ts';

export const REASONS = ['waits_on', 'to_confirm', 'holding_up', 'due', 'unsettled', 'blocked', 'stale', 'under_way', 'ready'] as const;
export type Reason = (typeof REASONS)[number];

/** Days without a change, or a word that it is still true, before open work is said to be stale. */
export const STALE_DAYS = 14;

interface Row {
  kind: string | null;
  id: string;
  type: string;
  title: string;
  status: string;
  owner: string | null;
  is_open: boolean;
  due: string | null;
  updated_at: Date;
}

export interface Input {
  /** Whose attention: a person's id, or "me" (who is asking, else the workspace's owner). Everyone when left out. */
  person?: string;
  /** Only what is this item's or place's: itself, what lives in it, and all part of that or about it. */
  within?: string;
  /** Only these reasons, the kernel's or a pack's. All of them when left out. */
  reasons?: string[];
  /** What is due within this many days counts as due: 7 unless given. */
  days?: number;
  /** What nobody has changed in this many days is stale: 14 unless given. */
  stale_days?: number;
  /** latest: what changed most recently first, in place of the strongest reason first. */
  order?: 'latest';
  limit?: number;
}

/**
 * What a lens read, handed to attention as its state stage (src/region.ts): the items, with their fields, and the
 * links among them. Attention then reads no items or links of its own: what it answers is the state of what was read.
 */
export interface Read {
  entities: { id: string; type: string; kind: string | null; title: string; status: string; owner: string | null; is_open: boolean; props: Record<string, unknown>; updated_at: Date }[];
  /** Those that say what waits on what as the map keeps them, the rest by id. */
  relations: { type: string; from_id: string; to_id: string; for: string | null }[];
  /** What blocks what, when the lens has read it already. */
  graph?: BlockGraph;
}

/** What needs a person now, by the reasons only they act on: it waits on them, it is theirs to confirm, it is due, or it is theirs to settle. Of what a lens read, when it is given. */
export async function needsOf(l: Archipelago, person: string | null, read?: Read): Promise<Set<string>> {
  if (!person) return new Set();
  const { items } = await attention(l, { person, reasons: ['waits_on', 'to_confirm', 'due', 'unsettled'], limit: 100_000 }, read);
  return new Set(items.map((i) => i.id));
}

/** What deserves attention, and why: the state of what a lens read, or of the whole map. */
export async function attention(l: Archipelago, input: Input, read?: Read) {
  // The reasons packs declare, each weighed when it is asked for or the kernel's reason it joins is.
  const declared = l.registry.packs.flatMap((p) => parts(p).reasons);
  const known: string[] = [...REASONS, ...declared.map((d) => d.reason)];
  const wanted = new Set<string>(input.reasons?.length ? input.reasons : known);
  for (const r of wanted) if (!known.includes(r)) throw new Error(`"${r}" is not a reason: one of ${known.join(', ')}`);
  const weighed = declared.filter((d) => wanted.has(d.reason) || wanted.has(d.joins));
  for (const d of weighed) wanted.add(d.reason);
  const owner = (await l.setting<string>('me')) || null;
  const me = input.person === undefined ? null : input.person === 'me' ? l.viewer || owner : input.person;
  if (input.person !== undefined && !me) throw new Error('No person: give an id, or set the workspace owner (pelago init "Your Name").');
  const scope = input.within ? await scopeOf(l, input.within, true) : null;
  const staleDays = input.stale_days ?? STALE_DAYS;

  const rows: Row[] = read
    ? read.entities.filter((e) => e.is_open).map(({ id, type, kind, title, status, owner, is_open, props, updated_at }) => ({ id, type, kind, title, status, owner, is_open, due: typeof props.due === 'string' ? props.due : props.due == null ? null : String(props.due), updated_at }))
    : await rowsFor(l, me, me !== null && me === owner, scope, wanted, weighed.flatMap((d) => l.registry.family(d.of)));
  const reg = l.registry;
  // Only what is work or a question to someone: not people, places, records of the past, or the system's own.
  const live = new Map(rows.filter((e) => e.kind !== SYSTEM && (!scope || scope.has(e.id))).map((e) => [e.id, e]));
  // Someone's: owned by them, or owned by nobody when they are the workspace's owner.
  const theirs = (e: Row) => me === null || e.owner === me || (e.owner === null && me === owner);
  const found = new Map<string, { row: Row; reasons: Record<string, unknown>[] }>();
  const add = (e: Row | undefined, why: string, more: Record<string, unknown> = {}) => {
    if (!e || !wanted.has(why)) return;
    const at = found.get(e.id) ?? { row: e, reasons: [] };
    at.reasons.push({ why, ...more });
    found.set(e.id, at);
  };
  const titles = async (ids: string[]) => new Map((await l.db.query<{ id: string; title: string }>(`select id, title from entity where id = any($1::text[])`, [ids])).rows.map((r) => [r.id, r.title]));

  // Waiting on someone to answer or act.
  const waitsOn = reg.relationFamily('waits_on');
  const waits = read
    ? read.relations.filter((r) => waitsOn.includes(r.type))
    : (await l.db.query<{ from_id: string; to_id: string; for: string | null }>(`select from_id, to_id, props->>'for' as for from relation where type = any($1::text[]) and valid_to is null and from_id = any($2::text[])`, [waitsOn, rows.map((r) => r.id)])).rows;
  const who = await titles([...new Set(waits.map((w) => w.to_id))]);
  for (const w of waits) if (me === null || w.to_id === me) add(live.get(w.from_id), 'waits_on', { who: who.get(w.to_id) ?? w.to_id, ...(w.for && { for: w.for }) });

  // Blocked, and what holds others up: the roots every chain of blocking ends at.
  const blocking = ['blocked', 'holding_up', 'ready'].some((r) => wanted.has(r as Reason));
  const graph = read?.graph ?? (blocking ? await blockGraph(l, [...live.keys()]) : new BlockGraph([]));
  const blockedIds = [...graph.direct.keys()].filter((id) => live.has(id));
  const rootsOf = new Map(blockedIds.map((id) => [id, graph.roots(id)]));
  const rootTitles = await titles([...new Set([...rootsOf.values()].flat())]);
  const holding = new Map<string, number>();
  for (const roots of rootsOf.values()) for (const r of roots) holding.set(r, (holding.get(r) ?? 0) + 1);
  // Only work or a question holds others up: a person who is waited on is said so by waits_on.
  for (const [id, n] of holding) if (live.get(id) && theirs(live.get(id)!) && ['work', 'question'].includes(live.get(id)!.kind ?? '')) add(live.get(id), 'holding_up', { count: n });
  // A resource held by others says who holds it (as the asker may see them: a private session is not named).
  const holders = blockedIds.length ? await heldResources(l) : [];
  for (const id of blockedIds) {
    if (!theirs(live.get(id)!)) continue;
    const held = graph.direct.get(id)!.filter((e) => e.why === 'resource_held').flatMap((e) => holders.filter((h) => h.resource === e.y).map((h) => h.held_by_title));
    add(live.get(id), 'blocked', { by: rootsOf.get(id)!.map((r) => rootTitles.get(r) ?? r), ...(held.length && { held_by: held }) });
  }

  // Due, or past a limit, by the bound its type declares.
  const { due, under } = await pastBounds(l, input.days ?? 7, [...live.keys()]);
  for (const d of due) if (live.get(d.id) && theirs(live.get(d.id)!)) add(live.get(d.id), 'due', { on: d.due, overdue: d.overdue });
  for (const u of under) if (live.get(u.id) && theirs(live.get(u.id)!)) add(live.get(u.id), 'due', { value: u.value, limit: u.limit });

  // Unsettled: a question whose type says how it settles, and whose word settles it.
  for (const e of live.values()) {
    const settles = reg.type(e.type)?.capabilities.settles;
    if (!settles) continue;
    const decider = settles.whose === 'owner' ? (e.owner ?? owner) : e.owner;
    if (me === null || decider === me) add(e, 'unsettled', { by: settles.by });
  }

  // Under way: a session at work on it.
  const { rows: at } = await l.db.query<{ target: string; n: number }>(
    `select r.to_id as target, count(*)::int as n from relation r join entity s on s.id = r.from_id
     where r.type = 'sys.works_on' and r.valid_to is null and s.is_open and s.archived_at is null and r.to_id = any($1::text[]) group by r.to_id`,
    [[...live.keys()]],
  );
  for (const a of at) if (live.get(a.target) && theirs(live.get(a.target)!)) add(live.get(a.target), 'under_way', { sessions: a.n });

  // Stale: work or a question nobody has changed, or said is still true, for a while. Ready: work that can be
  // estimated and taken up, with nothing in its way.
  const cutoff = Date.now() - staleDays * 86_400_000;
  for (const e of live.values()) {
    const kind = e.kind;
    if (!theirs(e) || (kind !== 'work' && kind !== 'question')) continue;
    if (new Date(e.updated_at).getTime() <= cutoff) add(e, 'stale', { days: Math.floor((Date.now() - new Date(e.updated_at).getTime()) / 86_400_000) });
    if (kind === 'work' && reg.type(e.type)?.fields.tokens_estimated && !graph.isBlocked(e.id)) add(e, 'ready');
  }

  // What a pack declares deserves it: its items whose fields hold the values it names, with its mark and its ask.
  for (const d of weighed) {
    const types = reg.family(d.of);
    const ids = [...live.values()].filter((e) => types.includes(e.type) && theirs(e)).map((e) => e.id);
    if (!ids.length) continue;
    const { rows: hit } = await l.db.query<{ id: string }>(`select id from entity where id = any($1::text[]) and props @> $2::jsonb`, [ids, JSON.stringify(d.where)]);
    for (const h of hit) add(live.get(h.id), d.reason, { mark: d.mark ?? d.reason, tip: d.description, ...(d.ask && { ask: d.ask }) });
  }

  // What agents settled and the owner has not confirmed: the owner's to look at, closed though it is.
  const confirm = wanted.has('to_confirm') && (me === null || me === owner) ? await toConfirm(l, { limit: 40 }) : undefined;
  // What was settled is closed: whether it is within is asked of the whole scope, for those few.
  const settledWithin = confirm && input.within ? await scopeOf(l, input.within, false, confirm.questions.map((q) => q.id)) : null;
  for (const q of confirm?.questions ?? []) {
    const row = { id: q.id, type: '', kind: null, title: q.title, status: '', owner: null, is_open: false, due: null, updated_at: q.settled } as Row;
    const { rows: [e] } = await l.db.query<Row>(`select id, type, kind, title, status, owner, is_open, props->>'due' as due, updated_at from entity where id = $1`, [q.id]);
    if (!settledWithin || settledWithin.has(q.id)) add(e ?? row, 'to_confirm', { answer: q.answer, on: q.on, seq: q.seq, settled: q.settled, by: q.by, ...(q.basis && { basis: q.basis }) });
  }

  // A pack's reason ranks just after the kernel's it joins.
  const joins = new Map(declared.map((d) => [d.reason, REASONS.indexOf(d.joins as Reason) + 0.5]));
  const rank = (reasons: Record<string, unknown>[]) => Math.min(...reasons.map((r) => joins.get(r.why as string) ?? REASONS.indexOf(r.why as Reason)));
  // What to confirm keeps the order the owner should see it in: what agents settled on their own judgment first.
  const asked = new Map((confirm?.questions ?? []).map((q, i) => [q.id, i]));
  const place = (id: string) => asked.get(id) ?? Infinity;
  const newer = (a: { row: Row }, b: { row: Row }) => +new Date(b.row.updated_at) - +new Date(a.row.updated_at);
  const items = [...found.values()]
    .sort((a, b) => (input.order === 'latest' && newer(a, b)) || rank(a.reasons) - rank(b.reasons) || place(a.row.id) - place(b.row.id) || String(a.row.due ?? '9').localeCompare(String(b.row.due ?? '9')) || +new Date(b.row.updated_at) - +new Date(a.row.updated_at))
    .map(({ row, reasons }) => ({ id: row.id, type: row.type, kind: row.kind ?? null, title: row.title, status: row.status, owner: row.owner, open: row.is_open, due: row.due, changed: row.updated_at, reasons }));
  const counts = Object.fromEntries([...wanted].map((r) => [r, items.filter((i) => i.reasons.some((x) => x.why === r)).length]));
  const limit = input.limit ?? 100;
  // What each sits in at the top, for those sent: the outermost thing it is part of, for a page that groups by it.
  const tops = await topsOf(l, items.slice(0, limit).map((i) => i.id));
  return {
    person: me,
    within: input.within ?? null,
    counts,
    items: items.slice(0, limit).map((i) => ({ ...i, top: tops.get(i.id) ?? null })),
    ...(items.length > limit && { more: `The first ${limit} of ${items.length}: ask with a higher limit, fewer reasons, or a scope (within).` }),
    // What the confirmed tool needs to say the owner has answered for these.
    ...(confirm && { to_confirm: { count: confirm.count, on_agents_judgment: confirm.on_agents_judgment, on_owners_word: confirm.on_owners_word, upto: confirm.upto, how: confirm.how } }),
  };
}

/** Reasons read from the log or an index alone, which attention may give for everyone across the map. */
const EVERYONE = ['to_confirm'];

/**
 * The open items attention weighs, read by what it is asked for and no wider: what is inside an item or a place
 * (within); else what is a person's (owned by them, or by nobody when they are the workspace's owner) and what waits
 * on them. For everyone across the map, only reasons the log answers: weighing every open item would read them all.
 */
async function rowsFor(l: Archipelago, me: string | null, isOwner: boolean, scope: Set<string> | null, wanted: Set<string>, declared: string[]): Promise<Row[]> {
  const cols = `id, type, kind, title, status, owner, is_open, props->>'due' as due, updated_at`;
  const notSystem = `(kind is null or kind <> '${SYSTEM}')`;
  if (scope) return (await l.db.query<Row>(`select ${cols} from entity where id = any($1::text[]) and is_open and archived_at is null and ${notSystem}`, [[...scope]])).rows;
  if (me !== null) {
    // What nobody owns is the owner's: of it, only what a reason asked for can be (work and questions; for what is
    // due, unsettled or waits on them alone, only what has a bound or settles), never every open item.
    const reg = l.registry;
    const kept = [...reg.having('bound'), ...reg.having('settles'), ...declared];
    const broad = ['blocked', 'holding_up', 'stale', 'ready', 'under_way'].some((r) => wanted.has(r));
    const unowned = broad ? `(kind in ('work', 'question') or type = any($4::text[]))` : `type = any($4::text[])`;
    const { rows } = await l.db.query<Row>(
      `select ${cols} from entity where is_open and archived_at is null and ${notSystem} and (owner = $1 or ($2 and owner is null and ${unowned}))
       union select ${cols} from entity where is_open and archived_at is null and id in (select from_id from relation where to_id = $1 and type = any($3::text[]) and valid_to is null)`,
      [me, isOwner, reg.relationFamily('waits_on'), kept],
    );
    if (!wanted.has('holding_up')) return rows;
    // What theirs holds up: whatever waits on it, step by step back along the links that block.
    const { rows: held } = await l.db.query<Row>(
      `with recursive back(id) as (select unnest($1::text[]) union select r.from_id from relation r join back b on r.to_id = b.id where r.valid_to is null and r.type = any($2::text[]))
       select ${cols} from entity where id in (select id from back) and not (id = any($1::text[])) and is_open and archived_at is null`,
      [rows.map((r) => r.id), l.registry.relationFamily('depends_on', 'waits_on', 'needs')],
    );
    return [...rows, ...held];
  }
  if ([...wanted].some((r) => !EVERYONE.includes(r))) throw new Error(`attention reads for a person (person) or within an item or a place (within); for everyone across the map, only ${EVERYONE.join(', ')}: weighing every open item would read the whole map.`);
  return [];
}

/** The outermost thing each item is part of, from the part_of closure: the ancestor that is part of nothing. */
async function topsOf(l: Archipelago, ids: string[]): Promise<Map<string, { id: string; title: string }>> {
  const { rows } = await l.db.query<{ id: string; top: string; title: string }>(
    `select distinct on (c.descendant) c.descendant as id, c.ancestor as top, e.title from part_closure c join entity e on e.id = c.ancestor
     where c.descendant = any($1::text[]) and not exists (select 1 from part_closure up where up.descendant = c.ancestor)
     order by c.descendant, c.ancestor`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, { id: r.top, title: r.title }]));
}

/** What each view attention replaced asks it now. */
export const REPLACED: Record<string, string> = {
  needs_me: '{ person: "me", reasons: ["waits_on", "to_confirm", "due", "unsettled", "ready"] }',
  blocked_on_me: '{ person: "me", reasons: ["holding_up"] }',
  waiting_on: '{ person: "me", reasons: ["blocked"] }',
  at_risk: '{ reasons: ["due"], days: 7, within: <a project> }',
  blockers: '{ reasons: ["blocked"], within: <a project> }',
  available_now: '{ reasons: ["ready"], person: "me" }',
  oldest: '{ reasons: ["stale"], within: <an item or a repository> }',
  questions: '{ reasons: ["unsettled"], within: <a project> }',
  to_confirm: '{ person: "me", reasons: ["to_confirm"] }',
  home: '{ person: "me" }: Home is a screen now',
};
