// Attention: the one standing question the kernel answers. What deserves attention, and why: for a person or for
// everyone, within a scope or across the map. Every reason is read from the root relations and the capabilities, so
// no way of working is named here: what waits on someone (waits_on), what holds others up and what is blocked
// (depends_on, waits_on, needs), what is due (bound), what is unsettled (settles), what nobody has touched, what is
// under way (a session on it), what is ready to take up, and what an agent settled that the owner has not confirmed.

import { pastBounds } from './bounds.ts';
import { blockGraph, heldResources } from './blocking.ts';
import { toConfirm } from './confirm.ts';
import type { Archipelago } from './pelago.ts';
import { scopeOf } from './places.ts';

export const REASONS = ['waits_on', 'to_confirm', 'holding_up', 'due', 'unsettled', 'blocked', 'stale', 'under_way', 'ready'] as const;
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
}

export interface Input {
  /** Whose attention: a person's id, or "me" (who is asking, else the workspace's owner). Everyone when left out. */
  person?: string;
  /** Only what is this item's or place's: itself, what lives in it, and all part of that or about it. */
  within?: string;
  /** Only these reasons. All of them when left out. */
  reasons?: Reason[];
  /** What is due within this many days counts as due: 7 unless given. */
  days?: number;
  /** What nobody has changed in this many days is stale: 14 unless given. */
  stale_days?: number;
  /** latest: what changed most recently first, in place of the strongest reason first. */
  order?: 'latest';
  limit?: number;
}

export async function attention(l: Archipelago, input: Input) {
  const wanted = new Set<Reason>(input.reasons?.length ? input.reasons : REASONS);
  for (const r of wanted) if (!REASONS.includes(r)) throw new Error(`"${r}" is not a reason: one of ${REASONS.join(', ')}`);
  const owner = (await l.setting<string>('me')) || null;
  const me = input.person === undefined ? null : input.person === 'me' ? l.viewer || owner : input.person;
  if (input.person !== undefined && !me) throw new Error('No person: give an id, or set the workspace owner (pelago init "Your Name").');
  const scope = input.within ? await scopeOf(l, input.within) : null;
  const staleDays = input.stale_days ?? STALE_DAYS;

  const { rows } = await l.db.query<Row>(`select id, type, title, status, owner, is_open, props->>'due' as due, updated_at from entity where archived_at is null and is_open`);
  const reg = l.registry;
  // Only what is work or a question to someone: not people, places, records of the past, or the system's own.
  const kindOf = (type: string) => reg.type(type)?.kind;
  const live = new Map(rows.filter((e) => !reg.type(e.type)?.system && (!scope || scope.has(e.id))).map((e) => [e.id, e]));
  // Someone's: owned by them, or owned by nobody when they are the workspace's owner.
  const theirs = (e: Row) => me === null || e.owner === me || (e.owner === null && me === owner);
  const found = new Map<string, { row: Row; reasons: Record<string, unknown>[] }>();
  const add = (e: Row | undefined, why: Reason, more: Record<string, unknown> = {}) => {
    if (!e || !wanted.has(why)) return;
    const at = found.get(e.id) ?? { row: e, reasons: [] };
    at.reasons.push({ why, ...more });
    found.set(e.id, at);
  };
  const titles = async (ids: string[]) => new Map((await l.db.query<{ id: string; title: string }>(`select id, title from entity where id = any($1::text[])`, [ids])).rows.map((r) => [r.id, r.title]));

  // Waiting on someone to answer or act.
  const { rows: waits } = await l.db.query<{ from_id: string; to_id: string; for: string | null }>(
    `select from_id, to_id, props->>'for' as for from relation where type = any($1::text[]) and valid_to is null`,
    [reg.relationFamily('waits_on')],
  );
  const who = await titles([...new Set(waits.map((w) => w.to_id))]);
  for (const w of waits) if (me === null || w.to_id === me) add(live.get(w.from_id), 'waits_on', { who: who.get(w.to_id) ?? w.to_id, ...(w.for && { for: w.for }) });

  // Blocked, and what holds others up: the roots every chain of blocking ends at.
  const graph = await blockGraph(l);
  const blockedIds = [...graph.direct.keys()].filter((id) => live.has(id));
  const rootsOf = new Map(blockedIds.map((id) => [id, graph.roots(id)]));
  const rootTitles = await titles([...new Set([...rootsOf.values()].flat())]);
  const holding = new Map<string, number>();
  for (const roots of rootsOf.values()) for (const r of roots) holding.set(r, (holding.get(r) ?? 0) + 1);
  // Only work or a question holds others up: a person who is waited on is said so by waits_on.
  for (const [id, n] of holding) if (live.get(id) && theirs(live.get(id)!) && ['work', 'question'].includes(kindOf(live.get(id)!.type) ?? '')) add(live.get(id), 'holding_up', { count: n });
  // A resource held by others says who holds it (as the asker may see them: a private session is not named).
  const holders = await heldResources(l);
  for (const id of blockedIds) {
    if (!theirs(live.get(id)!)) continue;
    const held = graph.direct.get(id)!.filter((e) => e.why === 'resource_held').flatMap((e) => holders.filter((h) => h.resource === e.y).map((h) => h.held_by_title));
    add(live.get(id), 'blocked', { by: rootsOf.get(id)!.map((r) => rootTitles.get(r) ?? r), ...(held.length && { held_by: held }) });
  }

  // Due, or past a limit, by the bound its type declares.
  const { due, under } = await pastBounds(l, input.days ?? 7);
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
     where r.type = 'sys.works_on' and r.valid_to is null and s.is_open and s.archived_at is null group by r.to_id`,
  );
  for (const a of at) if (live.get(a.target) && theirs(live.get(a.target)!)) add(live.get(a.target), 'under_way', { sessions: a.n });

  // Stale: work or a question nobody has changed, or said is still true, for a while. Ready: work that can be
  // estimated and taken up, with nothing in its way.
  const cutoff = Date.now() - staleDays * 86_400_000;
  for (const e of live.values()) {
    const kind = kindOf(e.type);
    if (!theirs(e) || (kind !== 'work' && kind !== 'question')) continue;
    if (new Date(e.updated_at).getTime() <= cutoff) add(e, 'stale', { days: Math.floor((Date.now() - new Date(e.updated_at).getTime()) / 86_400_000) });
    if (kind === 'work' && reg.type(e.type)?.fields.tokens_estimated && !graph.isBlocked(e.id)) add(e, 'ready');
  }

  // What agents settled and the owner has not confirmed: the owner's to look at, closed though it is.
  const confirm = wanted.has('to_confirm') && (me === null || me === owner) ? await toConfirm(l, { limit: 40 }) : undefined;
  for (const q of confirm?.questions ?? []) {
    const row = { id: q.id, type: '', title: q.title, status: '', owner: null, is_open: false, due: null, updated_at: q.settled } as Row;
    const { rows: [e] } = await l.db.query<Row>(`select id, type, title, status, owner, is_open, props->>'due' as due, updated_at from entity where id = $1`, [q.id]);
    if (!scope || scope.has(q.id)) add(e ?? row, 'to_confirm', { answer: q.answer, on: q.on, seq: q.seq, settled: q.settled, by: q.by, ...(q.basis && { basis: q.basis }) });
  }

  // What each sits in at the top: the outermost thing it is part of, for a page that groups by it.
  const { rows: parts } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'part_of' and valid_to is null order by id`);
  const up = new Map<string, string>();
  for (const p of parts) if (!up.has(p.from_id) && p.from_id !== p.to_id) up.set(p.from_id, p.to_id);
  const topOf = (id: string) => {
    let at = id;
    for (let steps = 0, next = up.get(at); next !== undefined && steps < 64; steps++, next = up.get(at)) at = next;
    return at === id ? null : at;
  };
  const tops = await titles([...new Set([...found.keys()].map(topOf).filter((t): t is string => t !== null))]);

  const rank = (reasons: Record<string, unknown>[]) => Math.min(...reasons.map((r) => REASONS.indexOf(r.why as Reason)));
  // What to confirm keeps the order the owner should see it in: what agents settled on their own judgment first.
  const asked = new Map((confirm?.questions ?? []).map((q, i) => [q.id, i]));
  const place = (id: string) => asked.get(id) ?? Infinity;
  const newer = (a: { row: Row }, b: { row: Row }) => +new Date(b.row.updated_at) - +new Date(a.row.updated_at);
  const items = [...found.values()]
    .sort((a, b) => (input.order === 'latest' && newer(a, b)) || rank(a.reasons) - rank(b.reasons) || place(a.row.id) - place(b.row.id) || String(a.row.due ?? '9').localeCompare(String(b.row.due ?? '9')) || +new Date(b.row.updated_at) - +new Date(a.row.updated_at))
    .map(({ row, reasons }) => {
      const top = topOf(row.id);
      return { id: row.id, type: row.type, kind: kindOf(row.type) ?? null, title: row.title, status: row.status, owner: row.owner, open: row.is_open, due: row.due, changed: row.updated_at, reasons, top: top ? { id: top, title: tops.get(top) ?? top } : null };
    });
  const counts = Object.fromEntries([...wanted].map((r) => [r, items.filter((i) => i.reasons.some((x) => x.why === r)).length]));
  const limit = input.limit ?? 100;
  return {
    person: me,
    within: input.within ?? null,
    counts,
    items: items.slice(0, limit),
    ...(items.length > limit && { more: `The first ${limit} of ${items.length}: ask with a higher limit, fewer reasons, or a scope (within).` }),
    // What the confirmed tool needs to say the owner has answered for these.
    ...(confirm && { to_confirm: { count: confirm.count, on_agents_judgment: confirm.on_agents_judgment, on_owners_word: confirm.on_owners_word, upto: confirm.upto, how: confirm.how } }),
  };
}

/** What each view attention replaced asks it now. */
export const REPLACED: Record<string, string> = {
  needs_me: '{ person: "me", reasons: ["waits_on", "to_confirm", "due", "unsettled", "ready"] }',
  blocked_on_me: '{ person: "me", reasons: ["holding_up"] }',
  waiting_on: '{ person: "me", reasons: ["blocked"] }',
  at_risk: '{ reasons: ["due"], days: 7 }',
  blockers: '{ reasons: ["blocked"] }',
  available_now: '{ reasons: ["ready"] }',
  oldest: '{ reasons: ["stale"], within: <an item or a repository> }',
  questions: '{ reasons: ["unsettled"], within: <a project> }',
  to_confirm: '{ person: "me", reasons: ["to_confirm"] }',
  home: '{ person: "me" }: Home is a screen now',
};
