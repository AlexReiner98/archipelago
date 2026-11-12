// Attention: the one standing question the kernel answers. What deserves attention, and why: for a person or for
// everyone, within a scope or across the map. Every reason is read from the root relations and the capabilities, so
// no way of working is named here: what waits on someone (waits_on), what holds others up and what is blocked
// (depends_on, waits_on, needs), what is due (bound), what is unsettled (settles), what nobody has touched, what is
// under way (a session on it), what is ready to take up, what an agent settled that the owner has not confirmed, and
// what reads a finding that has moved since (a link that crosses, to a type that promises fields: packs/attention/kernel/moved.ts).
// A pack adds reasons of its own as data (a view of form "attention"): items of a type whose fields hold some values.

import type { KernelContext } from '#pelago/kernel';
import { pastBounds } from './bounds.ts';
import { BlockGraph, type Edge } from './blocks.ts';
import { toConfirm } from './confirm.ts';
import { movedReadings, readersOf } from './moved.ts';
import { asText, byId, contains, type Item, type Link } from './rows.ts';

export const REASONS = ['waits_on', 'to_confirm', 'holding_up', 'due', 'moved', 'unsettled', 'blocked', 'stale', 'under_way', 'ready'] as const;
export type Reason = (typeof REASONS)[number];

/** Days without a change, or a word that it is still true, before open work is said to be stale. */
export const STALE_DAYS = 14;

interface Row {
  id: string;
  type: string;
  title: string;
  status: string;
  owner: string | null;
  is_open: boolean;
  due: string | null;
  updated_at: Date;
  /** Its fields, for a reason a pack declares. */
  props?: Record<string, unknown>;
}

/** A reason a pack declares as data (a view of form "attention"): items of a type whose fields hold some values. */
interface Declared { id: string; reason: string; of: string; where: Record<string, unknown>; joins: string; mark?: string; description?: string; ask?: unknown }

/** The reasons the active packs declare (their views of form "attention"). */
const declaredOf = (ctx: KernelContext): Declared[] =>
  ctx.registry.packs.flatMap((p) => ((p as { views?: { form?: string }[] }).views ?? []).filter((v) => v.form === 'attention').map(({ form: _f, ...rest }) => rest as unknown as Declared));

/** Whether an item of this type is the kernel's own (its type says it is the system's). */
const isKernel = (ctx: KernelContext, type: string) => ctx.registry.types.get(type)?.system === true;

/** An item as attention weighs it. */
const rowOf = (e: Item): Row => ({ id: e.id, type: e.type, title: e.title, status: e.status, owner: e.owner, is_open: e.is_open, due: asText(e.props?.due), updated_at: e.updated_at, props: e.props });

export interface Input {
  /** Whose attention: a person's id, or "me" (who is asking, else the workspace's owner). Everyone when left out. */
  person?: string;
  /** Only what is this item's or place's: itself, what lives in it, and all part of that or about it. */
  within?: string;
  /** Only these items: a set another read found (the frontier's), weighed as within weighs a scope. */
  among?: string[];
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
 * What a lens read, handed to attention as its state stage (packs/surface/kernel/region.ts): the items, with their fields, and the
 * links among them. Attention then reads no items or links of its own: what it answers is the state of what was read.
 */
export interface Read {
  entities: { id: string; type: string; title: string; status: string; owner: string | null; is_open: boolean; props: Record<string, unknown>; updated_at: Date }[];
  /** Those that say what waits on what as the map keeps them, the rest by id. */
  relations: { type: string; from_id: string; to_id: string; for: string | null }[];
  /** What blocks what, when the lens has read it already. */
  graph?: { direct: Map<string, Edge[]>; isBlocked(id: string): boolean; roots(id: string): string[] };
}

/** What deserves attention, and why: the state of what a lens read, or of the whole map. */
export async function attention(ctx: KernelContext, input: Input, read?: Read) {
  // The reasons packs declare, each weighed when it is asked for or the kernel's reason it joins is.
  const declared = declaredOf(ctx);
  const known: string[] = [...REASONS, ...declared.map((d) => d.reason)];
  const wanted = new Set<string>(input.reasons?.length ? input.reasons : known);
  for (const r of wanted) if (!known.includes(r)) throw new Error(`"${r}" is not a reason: one of ${known.join(', ')}`);
  const weighed = declared.filter((d) => wanted.has(d.reason) || wanted.has(d.joins));
  for (const d of weighed) wanted.add(d.reason);
  const owner = (await ctx.reads({ owner: true })) as string | null;
  // "me" is who is asking, else the workspace's owner (the read me).
  const me = input.person === undefined ? null : input.person === 'me' ? ((await ctx.reads({ me: true })) as string | null) : input.person;
  if (input.person !== undefined && !me) throw new Error('No person: give an id, or set the workspace owner (pelago init "Your Name").');
  const scope = input.within ? new Set((await ctx.reads({ within: { id: input.within, open: true } })) as string[]) : input.among ? new Set(input.among) : null;
  const staleDays = input.stale_days ?? STALE_DAYS;

  const rows: Row[] = read
    ? read.entities.filter((e) => e.is_open).map(({ id, type, title, status, owner, is_open, props, updated_at }) => ({ id, type, title, status, owner, is_open, due: typeof props.due === 'string' ? props.due : props.due == null ? null : String(props.due), updated_at }))
    : await rowsFor(ctx, me, me !== null && me === owner, scope, wanted, weighed.flatMap((d) => ctx.registry.family(d.of)));
  const reg = ctx.registry;
  // Only what is work or a question to someone: not people, places, records of the past, or the system's own.
  const live = new Map(rows.filter((e) => !isKernel(ctx, e.type) && (!scope || scope.has(e.id))).map((e) => [e.id, e]));
  // Someone's: owned by them, or owned by nobody when they are the workspace's owner.
  const theirs = (e: Row) => me === null || e.owner === me || (e.owner === null && me === owner);
  const found = new Map<string, { row: Row; reasons: Record<string, unknown>[] }>();
  const add = (e: Row | undefined, why: string, more: Record<string, unknown> = {}) => {
    if (!e || !wanted.has(why)) return;
    const at = found.get(e.id) ?? { row: e, reasons: [] };
    at.reasons.push({ why, ...more });
    found.set(e.id, at);
  };
  const titles = async (ids: string[]) => new Map([...(await byId(ctx, ids)).values()].map((r) => [r.id, r.title]));

  // Waiting on someone to answer or act.
  const waitsOn = reg.relationFamily('waits_on');
  const waits = read
    ? read.relations.filter((r) => waitsOn.includes(r.type))
    : ((await ctx.reads({ links: { from: rows.map((r) => r.id), types: waitsOn } })) as Link[]).map((r) => ({ from_id: r.from_id, to_id: r.to_id, for: asText(r.props?.for) }));
  const who = await titles([...new Set(waits.map((w) => w.to_id))]);
  for (const w of waits) if (me === null || w.to_id === me) add(live.get(w.from_id), 'waits_on', { who: who.get(w.to_id) ?? w.to_id, ...(w.for && { for: w.for }) });

  // Blocked, and what holds others up: the roots every chain of blocking ends at.
  const blocking = ['blocked', 'holding_up', 'ready'].some((r) => wanted.has(r as Reason));
  const graph = read?.graph ?? new BlockGraph(blocking ? ((await ctx.reads({ blocks: [...live.keys()] })) as Edge[]) : []);
  const blockedIds = [...graph.direct.keys()].filter((id) => live.has(id));
  const rootsOf = new Map(blockedIds.map((id) => [id, graph.roots(id)]));
  const rootTitles = await titles([...new Set([...rootsOf.values()].flat())]);
  const holding = new Map<string, number>();
  for (const roots of rootsOf.values()) for (const r of roots) holding.set(r, (holding.get(r) ?? 0) + 1);
  // Only what is actionable holds others up: a person who is waited on is said so by waits_on.
  const actionable = (e: Row) => Boolean(reg.type(e.type)?.capabilities.actionable);
  for (const [id, n] of holding) if (live.get(id) && theirs(live.get(id)!) && actionable(live.get(id)!)) add(live.get(id), 'holding_up', { count: n });
  // A resource held by others says who holds it (as the asker may see them: a private session is not named).
  const holders = blockedIds.length ? ((await ctx.reads({ holds: true })) as { resource: string; held_by_title: string }[]) : [];
  for (const id of blockedIds) {
    if (!theirs(live.get(id)!)) continue;
    const held = graph.direct.get(id)!.filter((e) => e.why === 'resource_held').flatMap((e) => holders.filter((h) => h.resource === e.y).map((h) => h.held_by_title));
    add(live.get(id), 'blocked', { by: rootsOf.get(id)!.map((r) => rootTitles.get(r) ?? r), ...(held.length && { held_by: held }) });
  }

  // Due, or past a limit, by the bound its type declares.
  const { due, under } = await pastBounds(ctx, input.days ?? 7, [...live.keys()]);
  for (const d of due) if (live.get(d.id) && theirs(live.get(d.id)!)) add(live.get(d.id), 'due', { on: d.due, overdue: d.overdue });
  for (const u of under) if (live.get(u.id) && theirs(live.get(u.id)!)) add(live.get(u.id), 'due', { value: u.value, limit: u.limit });

  // Moved: what it reads has changed since it was last changed or said still true, until whoever tends it does either.
  if (wanted.has('moved')) {
    const moved = await movedReadings(ctx, [...live.values()].filter(theirs).map((e) => e.id));
    for (const [id, readings] of moved) for (const m of readings) add(live.get(id), 'moved', { ...m });
  }

  // Unsettled: a question whose type says how it settles, and whose word settles it.
  for (const e of live.values()) {
    const settles = reg.type(e.type)?.capabilities.settles;
    if (!settles) continue;
    const decider = settles.whose === 'owner' ? (e.owner ?? owner) : e.owner;
    if (me === null || decider === me) add(e, 'unsettled', { by: settles.by });
  }

  // Under way: a session at work on it.
  const works = (await ctx.reads({ links: { to: [...live.keys()], types: ['works_on'] } })) as Link[];
  const sessions = await byId(ctx, [...new Set(works.map((w) => w.from_id))]);
  const at = new Map<string, number>();
  for (const w of works) if (sessions.get(w.from_id)?.is_open && !sessions.get(w.from_id)!.archived_at) at.set(w.to_id, (at.get(w.to_id) ?? 0) + 1);
  for (const [target, n] of at) if (live.get(target) && theirs(live.get(target)!)) add(live.get(target), 'under_way', { sessions: n });

  // Stale: what is actionable and nobody has changed, or said is still true, for a while. Ready: work to plan that
  // can be estimated and taken up, with nothing in its way.
  const cutoff = Date.now() - staleDays * 86_400_000;
  for (const e of live.values()) {
    if (!theirs(e) || !actionable(e)) continue;
    const type = reg.type(e.type);
    if (new Date(e.updated_at).getTime() <= cutoff) add(e, 'stale', { days: Math.floor((Date.now() - new Date(e.updated_at).getTime()) / 86_400_000) });
    if (type?.capabilities.plannable && type.fields.tokens_estimated && !graph.isBlocked(e.id)) add(e, 'ready');
  }

  // What a pack declares deserves it: its items whose fields hold the values it names, with its mark and its ask.
  for (const d of weighed) {
    const types = reg.family(d.of);
    const ids = [...live.values()].filter((e) => types.includes(e.type) && theirs(e)).map((e) => e.id);
    if (!ids.length) continue;
    const props = new Map([...(await byId(ctx, ids)).values()].map((e) => [e.id, e.props]));
    for (const id of ids) if (contains(props.get(id), d.where)) add(live.get(id), d.reason, { mark: d.mark ?? d.reason, tip: d.description, ...(d.ask ? { ask: d.ask } : {}) });
  }

  // What agents settled and the owner has not confirmed: the owner's to look at, closed though it is.
  const confirm = wanted.has('to_confirm') && (me === null || me === owner) ? await toConfirm(ctx, { limit: 40 }) : undefined;
  // What was settled is closed: whether it is within is asked of the whole scope, for those few.
  const settledWithin = confirm && input.within ? new Set((await ctx.reads({ within: { id: input.within, among: confirm.questions.map((q) => q.id) } })) as string[]) : confirm && input.among ? new Set(input.among) : null;
  // The items settled, read at once: one read for them all, not one each.
  const settledRows = confirm?.questions.length ? new Map([...(await byId(ctx, confirm.questions.map((q) => q.id))).values()].map((e) => [e.id, rowOf(e)])) : new Map<string, Row>();
  for (const q of confirm?.questions ?? []) {
    const row = { id: q.id, type: '', title: q.title, status: '', owner: null, is_open: false, due: null, updated_at: q.settled } as Row;
    if (!settledWithin || settledWithin.has(q.id)) add(settledRows.get(q.id) ?? row, 'to_confirm', { answer: q.answer, on: q.on, seq: q.seq, settled: q.settled, by: q.by, ...(q.basis && { basis: q.basis }) });
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
    .map(({ row, reasons }) => ({ id: row.id, type: row.type, title: row.title, status: row.status, owner: row.owner, open: row.is_open, due: row.due, changed: row.updated_at, reasons }));
  const counts = Object.fromEntries([...wanted].map((r) => [r, items.filter((i) => i.reasons.some((x) => x.why === r)).length]));
  const limit = input.limit ?? 100;
  // What each sits in at the top, for those sent: the outermost thing it is part of, for a page that groups by it.
  const tops = await topsOf(ctx, items.slice(0, limit).map((i) => i.id));
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
async function rowsFor(ctx: KernelContext, me: string | null, isOwner: boolean, scope: Set<string> | null, wanted: Set<string>, declared: string[]): Promise<Row[]> {
  const reg = ctx.registry;
  const notSystem = (e: Item) => !isKernel(ctx, e.type);
  const live = (e: Item | undefined): e is Item => !!e && e.is_open && !e.archived_at;
  if (scope) return [...(await byId(ctx, [...scope])).values()].filter((e) => live(e) && notSystem(e)).map(rowOf);
  if (me !== null) {
    // What nobody owns is the owner's: of it, only what a reason asked for can be (what is actionable; for what is
    // due, unsettled or waits on them alone, only what has a bound or settles), never every open item.
    const broad = ['blocked', 'holding_up', 'stale', 'ready', 'under_way'].some((r) => wanted.has(r));
    const kept = [...(broad ? reg.having('actionable') : []), ...reg.having('bound'), ...reg.having('settles'), ...declared];
    const owned = ((await ctx.reads({ owned: { by: me, ...(isOwner && { also: kept }) } })) as Item[]).filter(notSystem);
    const waiting = (await ctx.reads({ links: { to: [me], types: reg.relationFamily('waits_on') } })) as Link[];
    const waits = [...(await byId(ctx, [...new Set(waiting.map((w) => w.from_id))])).values()].filter(live);
    const rows = [...new Map([...owned, ...waits].map((e) => [e.id, rowOf(e)])).values()];
    if (wanted.has('moved')) {
      const known = new Set(rows.map((r) => r.id));
      const readers = (await readersOf(ctx, me, isOwner)).filter((id) => !known.has(id));
      if (readers.length) rows.push(...[...(await byId(ctx, readers)).values()].filter(notSystem).map(rowOf));
    }
    if (!wanted.has('holding_up')) return rows;
    // What theirs holds up: whatever waits on it, step by step back along the links that block.
    const blocking = reg.relationFamily('depends_on', 'waits_on', 'needs');
    const start = new Set(rows.map((r) => r.id));
    const back = new Set(start);
    for (let level = [...start]; level.length; ) {
      const found = (await ctx.reads({ links: { to: level, types: blocking } })) as Link[];
      level = [...new Set(found.map((r) => r.from_id))].filter((id) => !back.has(id) && back.add(id));
    }
    const held = [...(await byId(ctx, [...back].filter((id) => !start.has(id)))).values()].filter(live).map(rowOf);
    return [...rows, ...held];
  }
  if ([...wanted].some((r) => !EVERYONE.includes(r))) throw new Error(`attention reads for a person (person) or within an item or a place (within); for everyone across the map, only ${EVERYONE.join(', ')}: weighing every open item would read the whole map.`);
  return [];
}

/** The outermost thing each item is part of, from the part_of closure: the ancestor that is part of nothing. */
async function topsOf(ctx: KernelContext, ids: string[]): Promise<Map<string, { id: string; title: string }>> {
  const rows = (await ctx.reads({ tops: ids })) as { id: string; top: string; title: string }[];
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

/** answer.attention (pack.json, kernel.provides): a lens preset's params, its lens and choices set aside. */
export const answer = (ctx: KernelContext, { lens: _lens, choices: _choices, ...params }: Input & { lens?: unknown; choices?: unknown }) => attention(ctx, params);
