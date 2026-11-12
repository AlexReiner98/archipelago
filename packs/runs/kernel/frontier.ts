// The frontier: where a session stands on the map, and what there needs it. A new session is not told a story of the
// last one; it is placed. Its place is read from where it runs (a repository the map knows, else the folder, a
// worktree read as the checkout it was made from), the sessions that worked there before it, and what each changed
// (the log: every change keeps its run), touched (what the sessions pack keeps of it) or worked on. From that work, one step along part_of
// either way, the open items are weighed by why each needs attention now, what is unfinished before what is recent:
// what the owner corrected since an agent last touched it, what waits on someone, what was left mid-way, what is
// blocked, what nobody has seen working, what is open. Nothing here is written for the next session: it is all read
// off what is already true, and the same answer is the agent's start and the person's (query frontier).

import type { KernelContext } from '#pelago/kernel';
import { livesIn, placeFor } from './places.ts';

/** The strongest first: a reason's place in this list is its rank. Attention's reasons this view does not weigh are left out. */
export const FRONTIER_REASONS = ['corrected', 'waits_on', 'to_confirm', 'unsettled', 'left', 'under_way', 'holding_up', 'blocked', 'moved', 'due', 'unseen', 'open'] as const;
export type FrontierReason = (typeof FRONTIER_REASONS)[number];

/** How far back the sessions in a place are read, and how many of them. */
const DAYS = 60;
const RUNS = 20;

/** A folder as one key: its slashes one way, no trailing slash, any case, and a worktree read as the checkout it was made from. */
export const folderKey = (path: string) =>
  path
    .replaceAll('\\', '/')
    .replace(/\/+$/, '')
    .toLowerCase()
    .replace(/\/\.claude\/worktrees\/[^/]+$/, '');

export interface FrontierInput {
  /** The session asking: its place is read from it, and it is left out of the sessions before. With no folder or remote, its own or given, the place is the whole workspace: its recent sessions wherever they ran (Home, a chat). */
  run?: string;
  cwd?: string;
  remote?: string;
  limit?: number;
}

export interface FrontierItem {
  id: string;
  type: string;
  title: string;
  status: string;
  reasons: { why: FrontierReason; [k: string]: unknown }[];
}

/** What attention answers of some items (packs/attention, answer.attention): the part read here. */
type Weighed = { items: { id: string; type: string; title: string; status: string; reasons: { why: string; [k: string]: unknown }[] }[] };

/** A run as the frontier reads it. */
type Run = { id: string; title: string; props: Record<string, unknown>; created_at: Date; updated_at: Date };

/** How long ago the sessions it reads may have last been heard from, as a moment. */
const since = (ctx: KernelContext) => new Date(ctx.now().getTime() - DAYS * 86_400_000).toISOString();

/** The place a session is in, and the sessions before it there, the newest first. */
async function placed(ctx: KernelContext, input: FrontierInput) {
  const self = input.run ? (((await ctx.reads({ get: input.run })) as Run | null) ?? undefined) : undefined;
  const cwd = input.cwd ?? (typeof self?.props?.cwd === 'string' ? self.props.cwd : undefined);
  const repo = await placeFor(ctx, { cwd, remote: input.remote });
  const here = cwd ? folderKey(cwd) : undefined;
  const rows = (await ctx.reads({ runs_lately: { since: since(ctx) } })) as Run[];
  const inRepo = repo ? new Set(((await ctx.reads({ links: { to: [repo.id], types: livesIn(ctx) } })) as { from_id: string }[]).map((r) => r.from_id)) : new Set<string>();
  // Asked from nowhere in particular (a person's Home, or a chat with no folder: ChatGPT, Grok Bot), every place is
  // theirs: the workspace's recent sessions.
  const anywhere = !cwd && !input.remote;
  const runs = rows.filter((r) => r.id !== self?.id && (anywhere || inRepo.has(r.id) || (here !== undefined && typeof r.props.cwd === 'string' && folderKey(r.props.cwd) === here))).slice(0, RUNS);
  return { repo, folder: here, runs };
}

/** What sessions worked on: what they changed (the log keeps each change's run), touched, or were set to work on. */
export async function workedOn(ctx: KernelContext, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  // What they changed, were set to work on, and touched: three reads the reads API asks together.
  return (await ctx.reads({ worked_on: { runs: ids, since: since(ctx) } })) as string[];
}

/** One step along part_of either way: the hub a piece is in, and the pieces of a hub, so what the owner added to an agent's plan is in it too. */
async function around(ctx: KernelContext, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  return (await ctx.reads({ part_around: ids })) as string[];
}

/** What a person changed after an agent last did, item by item: who, when, and which fields. An item a person made inside an agent's work counts too. */
async function corrections(ctx: KernelContext, ids: string[]) {
  // Only the facts a person said after the last an agent (or anyone not a person) said of the item are sent: the
  // rest of each item's history is weighed where it lies, not read back whole (a busy map's thousand items are
  // some ten thousand facts).
  const rows = (await ctx.reads({ corrections: ids })) as { id: string; field: string; actor: string; at: Date; added: boolean }[];
  const out = new Map<string, { by: string; at: Date; fields: string[]; added: boolean }>();
  for (const [id, after] of Map.groupBy(rows, (r) => r.id)) {
    const last = after.at(-1)!;
    out.set(id, { by: last.actor, at: last.at, fields: [...new Set(after.map((f) => f.field))].filter((f) => f !== 'created_at'), added: last.added });
  }
  return out;
}

/** Where a session stands, and the open items there with why each needs attention now, the strongest first. */
export async function frontier(ctx: KernelContext, input: FrontierInput) {
  const { repo, folder, runs } = await placed(ctx, input);
  const reg = ctx.registry;
  const worked = await workedOn(ctx, runs.map((r) => r.id));
  const scope = await around(ctx, worked);
  const rows = (await ctx.reads({ run_items: scope })) as { id: string; type: string; title: string; status: string; is_open: boolean; props: Record<string, unknown> }[];
  // What the system keeps (a type the system's) is nobody's work.
  const mine = rows.filter((e) => reg.types.get(e.type)?.system !== true);
  const live = new Map(mine.filter((e) => e.is_open).map((e) => [e.id, e]));
  const found = new Map<string, FrontierItem>();
  // Only what is open, but for what an agent settled and the owner has not confirmed: closed, and still theirs to look at.
  const add = (id: string, why: FrontierReason, more: Record<string, unknown> = {}, closed?: { type: string; title: string; status: string }) => {
    const e = live.get(id) ?? (closed && { id, ...closed, props: {} });
    if (!e) return;
    const at = found.get(id) ?? { id, type: e.type, title: e.title, status: e.status, reasons: [] };
    at.reasons.push({ why, ...more });
    found.set(id, at);
  };

  // What the owner corrected: the most valuable memory there is, since it is what an agent got wrong or left out.
  // A person is named as the map knows them where it does, else by the name they act under.
  // A correction counts closed too: a decision the owner reversed or a task they closed is what an agent must not undo.
  const all = new Map(mine.map((e) => [e.id, e]));
  // A closed one only while it is news: changed since the last session here began.
  const since = runs[0] ? new Date(runs[0].created_at).getTime() : 0;
  for (const [id, c] of all.size ? await corrections(ctx, [...all.keys()]) : [])
    if (live.has(id) || new Date(c.at).getTime() > since) add(id, 'corrected', { by: c.by.slice('human:'.length), at: c.at, fields: c.fields, ...(c.added && { added: true }) }, all.get(id));

  // Attention's reasons, read among these items alone.
  const weighed = await ctx.call<unknown, Weighed>('answer.attention', { among: [...live.keys()], reasons: ['waits_on', 'to_confirm', 'unsettled', 'under_way', 'holding_up', 'blocked', 'moved', 'due', 'ready'], limit: 500 });
  const blocked = new Set<string>();
  for (const item of weighed.items)
    for (const r of item.reasons) {
      if (r.why === 'blocked') blocked.add(item.id);
      if (r.why === 'ready') continue;
      const { why, ...more } = r;
      add(item.id, why as FrontierReason, more, why === 'to_confirm' ? item : undefined);
    }
  const busy = new Set(weighed.items.filter((i) => i.reasons.some((r) => r.why === 'under_way')).map((i) => i.id));
  // A hub with open parts is not itself next: its parts are.
  const hub = new Set((await ctx.reads({ hubs_among: [...live.keys()] })) as string[]);

  for (const e of live.values()) {
    const type = reg.type(e.type);
    const phase = type?.statuses.phases?.[e.status];
    // Left mid-way: begun, and no session is on it now.
    if (phase === 'under_way' && !busy.has(e.id)) add(e.id, 'left', { status: e.status });
    // Built, and nobody has seen it working.
    if (e.props.seen_working === false) add(e.id, 'unseen', { ...(typeof e.props.to_see === 'string' && { to_see: e.props.to_see }) });
    // Open work with nothing in its way: what is next, when nothing above is.
    if (type?.capabilities.actionable && !blocked.has(e.id) && !busy.has(e.id) && !hub.has(e.id) && phase !== 'under_way') add(e.id, 'open');
  }

  const rank = (i: FrontierItem) => Math.min(...i.reasons.map((r) => FRONTIER_REASONS.indexOf(r.why)));
  // Only the strongest reason ranks an item; one that is merely open is said only when nothing stronger is.
  const items = [...found.values()].map((i) => (i.reasons.length > 1 ? { ...i, reasons: i.reasons.filter((r) => r.why !== 'open') } : i)).sort((a, b) => rank(a) - rank(b));
  const limit = input.limit ?? 12;
  const last = runs[0];
  return {
    place: { ...(repo && { repo: { id: repo.id, title: repo.title } }), ...(folder && { folder }) },
    // Who worked here is provenance, not memory: how many sessions, and when the last was heard from.
    before: { sessions: runs.length, ...(last && { last: { id: last.id, title: last.title, at: last.updated_at } }) },
    counts: Object.fromEntries(FRONTIER_REASONS.map((r) => [r, items.filter((i) => i.reasons.some((x) => x.why === r)).length]).filter(([, n]) => n)),
    items: items.slice(0, limit),
    ...(items.length > limit && { more: `${items.length - limit} more: query frontier with a higher limit, or brief on one of these.` }),
  };
}

/** A reason as a few words, for a line of text or a tip. */
export function said(r: FrontierItem['reasons'][number]): string {
  switch (r.why) {
    case 'corrected':
      return r.added ? `added by ${r.by}, not yet seen by an agent` : `changed by ${r.by} since an agent last did${(r.fields as string[]).length ? ` (${(r.fields as string[]).join(', ')})` : ''}`;
    case 'waits_on':
      return `waits on ${r.who}${r.for ? ` for ${r.for}` : ''}`;
    case 'to_confirm':
      return 'settled by an agent, not yet confirmed by the owner';
    case 'unsettled':
      return 'not decided';
    case 'left':
      return `left ${r.status} with no session on it`;
    case 'under_way':
      return 'another session is on it now';
    case 'holding_up':
      return `holds up ${r.count}`;
    case 'blocked':
      return `blocked by ${(r.by as string[]).join(', ')}`;
    case 'moved':
      return 'what it reads has changed';
    case 'due':
      return r.overdue ? `overdue (${r.on})` : `due ${r.on ?? ''}`.trim();
    case 'unseen':
      return `nobody has seen it working${r.to_see ? `: ${r.to_see}` : ''}`;
    default:
      return 'open, nothing in its way';
  }
}

/** The frontier as the lines a session is handed as it starts. */
export function frontierText(f: Awaited<ReturnType<typeof frontier>>): string[] {
  if (!f.before.sessions) return ['No session has worked here before on this map: nothing to pick up. What you make here is what the next session will find.'];
  const lines = [
    `Where this session stands: ${f.before.sessions} earlier ${f.before.sessions === 1 ? 'session' : 'sessions'} worked here. What their work reaches that is open, each with why it needs attention now, the strongest first. Walk from these (brief on one, or query flat) rather than starting fresh, and do not reopen what is decided.`,
  ];
  if (!f.items.length) lines.push('Nothing their work reaches is open.');
  for (const i of f.items) lines.push(`- ${i.title} (${i.id}), ${i.status}: ${i.reasons.map(said).join('; ')}`);
  if (f.more) lines.push(f.more);
  return lines;
}
