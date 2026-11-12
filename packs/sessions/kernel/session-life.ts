// Sessions on the pack's context: an agent session (or automation run) registers itself in the map as a run, says
// what it is working on, and takes the exclusive resources that work needs. These writes skip the proposal step, like
// claim and release: they are the session's own operational state, not facts about the world, and coordination that
// waits for approval is no coordination (the write path's root.bookkeep, ./bookkeeping.ts). What the owner's page is
// shown at once as it happens (a session titled, ended) is said in `shown`, for the map's calls (./sessions.ts) to
// show: presence names no service yet.

import type { KernelContext } from '#pelago/kernel';
import { bookkeep, changeAs, claimAs, operational, releaseAs } from './bookkeeping.ts';
import { hookRunHere, isChat, resolveRun, takeUp } from './chat-run.ts';
import { livesIn, livesInFor } from './places.ts';
import { unreconciled } from './reconcile.ts';
import { parentOps, parentRun } from './session-parent.ts';
import { cutTitle, mintName, saidTitle, sessionLabelled, sessionTitle } from './session-name.ts';
import { keepTouched } from './touched.ts';
import { actorId, type Actor, type Item, type Op } from './types.ts';

/** A step the owner's page is shown at once (presence's took): who, what, of which run, and whether its tab rests or ends. */
export type Shown = { actor: string; did: string; run: string; rests?: true; ends?: true };

const now = (ctx: Pick<KernelContext, 'now'>) => ctx.now().toISOString();
const itemOf = async (ctx: KernelContext, id: string) => ((await ctx.reads({ ids: [id] })) as Item[])[0];
const placeFor = async (ctx: KernelContext, keys: { cwd?: string; remote?: string }) =>
  (await ctx.call<{ cwd?: string; remote?: string }, { place: Item | null }>('answer.place_for', { ...(keys.cwd !== undefined && { cwd: keys.cwd }), ...(keys.remote !== undefined && { remote: keys.remote }) })).place ?? undefined;
const labelled = async (ctx: KernelContext, run: Item, label: unknown, actor: string, shown: Shown[]) => {
  if (await sessionLabelled(ctx, run, label, actor)) shown.push({ actor, did: 'titled', run: run.id });
};

/**
 * Whether a hook may speak for the session it names, when the token it came with is within some items: a session
 * that is starting has to be in a place that is theirs, and any other has to be one that was registered there.
 */
export async function hookWithin(ctx: KernelContext, within: string[], input: { session_id?: string; cwd?: string; remote?: string }, starting: boolean): Promise<boolean> {
  const [scope, place] = [new Set((await ctx.reads({ token_scope: within })) as string[]), starting ? await placeFor(ctx, { cwd: input.cwd, remote: typeof input.remote === 'string' ? input.remote : undefined }) : undefined];
  if (starting) return Boolean(place && scope.has(place.id));
  const run = input.session_id ? await resolveRun(ctx, input.session_id) : undefined;
  if (!run) return true; // nothing to speak for: the hook does nothing either way
  const rows = (await ctx.reads({ links: { from: [run.id], to: [...scope], types: livesIn(ctx) } })) as unknown[];
  return rows.length > 0;
}

/** When a surface's session registered here, if it did and is still open. */
export async function sessionBegan(ctx: KernelContext, sessionId: string | undefined): Promise<Date | undefined> {
  const run = sessionId ? await resolveRun(ctx, sessionId, true) : undefined;
  return run && new Date(run.created_at);
}

/** What a session says of itself as it registers. */
export type SessionSaid = { title?: string; surface?: string; cwd?: string; remote?: string; session_id?: string; task?: string; branch?: string; source?: string; parent?: string };

export async function sessionStart(ctx: KernelContext, actor: Actor, input: SessionSaid, shown: Shown[] = []) {
  const workspace = async () => ({ id: ctx.workspace, name: (await ctx.reads({ workspace_name: true })) as string });
  // The session that started this one, refused before anything is made when there is none.
  const parent = input.parent ? await parentRun(ctx, input.parent) : undefined;
  // A surface may announce the same session again (resume, compact), even ended: its own run takes up, not a second.
  if (input.session_id) {
    const existing = await resolveRun(ctx, input.session_id);
    if (existing) {
      await parented(ctx, actor, existing.id, parent);
      const reopened = !existing.is_open;
      if (reopened) await takeUp(ctx, actor, existing);
      await touch(ctx, existing.id);
      await nameIfUnnamed(ctx, actor, existing);
      await labelled(ctx, existing, input.title, actorId(actor), shown);
      // Its repository is said again: the hook tells a resumed session where things stand, as it told it at first.
      return { run: existing.id, name: ((await itemOf(ctx, existing.id))?.props.name as string | undefined) ?? existing.title, workspace: await workspace(), status: 'running', resumed: true, reopened, repo: (await placeFor(ctx, input)) ?? undefined };
    }
  }
  const task = input.task ? await itemOf(ctx, input.task) : undefined;
  if (input.task && !task) throw new Error(`No item "${input.task}" to work on`);
  // A chat its hook registered, told to register itself as well: the hook's run is this session, given what it is sent.
  const hooked = input.session_id ? undefined : await hookRunHere(ctx, input);
  if (hooked) {
    await touch(ctx, hooked.id);
    await labelled(ctx, hooked, input.title, actorId(actor), shown);
    const ops: Op[] = [];
    if (task) ops.push({ op: 'link', type: 'works_on', from: hooked.id, to: task.id });
    // Its hook recorded the map's packs; now it says its task, it runs under what the task's island runs.
    const packs = task && (await ctx.reads({ packs_at: { ...(typeof task.props.island === 'string' && { island: task.props.island }) } }));
    if (packs && JSON.stringify(packs) !== JSON.stringify(hooked.props.packs)) ops.push({ op: 'update', id: hooked.id, props: { packs } });
    if (input.branch && input.branch !== hooked.props.branch) ops.push({ op: 'update', id: hooked.id, props: { branch: input.branch } });
    if (parent) ops.push(...(await parentOps(ctx, hooked.id, parent)));
    if (ops.length) await bookkeep(ctx, actorId(actor), { ops, reason: 'Session registered again: its hook had registered it' });
  } else await ctx.call('root.sessions', { room: true });
  const repo = await placeFor(ctx, input);
  const { run, name, before } = hooked ? { run: hooked.id, name: hooked.props.name as string | undefined, before: undefined } : await newRun(ctx, actor, input, task, repo, parent);

  // Take every exclusive resource the task needs, or say who has it.
  const claimed: string[] = [];
  const blocked: { resource: string; title: string; why: string }[] = [];
  if (task) {
    const needed = (await ctx.reads({ needs_of: task.id })) as Item[];
    for (const res of needed) {
      try {
        if ((ctx.registry.capacity(res as never) ?? Infinity) === Infinity && res.status === 'available') continue;
        await claimAs(ctx, actor, { resource: res.id, holder: run, for: task.id, reason: `Needed for "${task.title}"` });
        claimed.push(res.title);
      } catch (err) {
        blocked.push({ resource: res.id, title: res.title, why: (err as Error).message });
      }
    }
  }
  if (blocked.length) await bookkeep(ctx, actorId(actor), { ops: [{ op: 'update', id: run, status: 'waiting' }], reason: `Waiting on ${blocked.map((b) => b.title).join(', ')}` });

  return {
    run,
    name,
    // The map this session writes to, first: a token made in the wrong workspace is plain before anything is written.
    workspace: await workspace(),
    took_over: before?.id,
    status: blocked.length ? 'waiting' : 'running',
    repo: repo && { id: repo.id, title: repo.title },
    claimed,
    blocked,
    note: blocked.length
      ? 'Do not start work that needs the resources listed under blocked. Take work that does not need them, or wait.'
      : 'Call report with action session_update and a note when something worth knowing happens, and report with action session_end when you finish.',
    joined: hooked ? true : undefined,
  };
}

/** A session's run, made: named, labelled, tied to its task and its place. */
async function newRun(ctx: KernelContext, actor: Actor, input: SessionSaid, task: Item | undefined, repo: Item | undefined, parent?: Item) {
  const props: Record<string, unknown> = { last_seen: now(ctx), active: stretch([], now(ctx), 'at') };
  for (const k of ['surface', 'cwd', 'session_id', 'branch'] as const) if (input[k]) props[k] = input[k];
  // The packs it ran under, each by version and the hash of its manifest, so a measure can tell the harness's versions
  // apart: on a task, those its task's island runs, so a trial of a version on one island is told from the rest.
  props.packs = await ctx.reads({ packs_at: { ...(typeof task?.props.island === 'string' && { island: task.props.island }) } });
  // Its word is its hue's key, never shown (./session-name.ts).
  const name = await mintName(ctx);
  if (name) props.name = name;
  // After a clear, the chat goes on as a new session: it takes over the tab of the one the clear ended.
  const before = input.source === 'clear' ? await clearedHere(ctx, input.cwd) : undefined;
  if (before) props.took_over = before.id;
  // It is called what its chat is called, else what the chat was called before the clear, else what it works on.
  const label = saidTitle(input.title) || (typeof before?.props.label === 'string' ? before.props.label : '');
  if (label) props.label = label;
  const title = label ? cutTitle(label) : sessionTitle({ task: task?.title, place: repo?.title ?? input.cwd });
  const ops: Op[] = [{ op: 'create', ref: 'run', type: 'run', title, status: 'running', props }];
  if (task) ops.push({ op: 'link', type: 'works_on', from: 'run', to: task.id });
  if (repo) ops.push({ op: 'link', type: livesInFor(ctx, repo.type), from: 'run', to: repo.id });
  if (parent) ops.push(...(await parentOps(ctx, 'run', parent, true)));
  const { created } = await bookkeep(ctx, actorId(actor), { ops, reason: 'Session started' });
  return { run: created.run, name, before };
}

/** A run is tied to the session that started it, if it said one and is not tied to it already. */
async function parented(ctx: KernelContext, actor: Actor, run: string, parent: Item | undefined): Promise<void> {
  const ops = parent ? await parentOps(ctx, run, parent) : [];
  if (ops.length) await bookkeep(ctx, actorId(actor), { ops, reason: 'Started from "' + parent!.title + '"' }); // concatenated: the structure test reads a quoted template after the word as an import
}

/** A session registered before sessions were given a word is given one, for its hue, when it is heard from again. */
async function nameIfUnnamed(ctx: KernelContext, actor: Actor, run: Item): Promise<void> {
  if (run.props.name) return;
  const name = await mintName(ctx);
  if (name) await bookkeep(ctx, actorId(actor), { ops: [{ op: 'update', id: run.id, props: { name } }], reason: 'Session given its mark' });
}

/** How soon after a clear ended a session the next one in its folder is taken to be the same chat going on. */
const CLEAR_MS = 2 * 60_000;
/** The session a clear ended a moment ago in this folder, whose chat goes on, and not already taken over. */
async function clearedHere(ctx: KernelContext, cwd: string | undefined): Promise<Item | undefined> {
  if (!cwd) return undefined;
  return ((await ctx.reads({ cleared_here: { cwd, since: new Date(ctx.now().getTime() - CLEAR_MS).toISOString() } })) as Item | null) ?? undefined;
}

/** Two signs of a session at work this close together are one stretch of work; further apart, it was idle between. */
export const IDLE_MS = 10 * 60_000;
/** Stretches kept on a run: past this, the oldest are let go. */
const STRETCHES_KEPT = 400;

/**
 * Add a sign of work to a run's stretches of activity. `at`: a turn begins, or something was heard from it (a new
 * stretch, unless the last ended a moment ago); `until`: a turn ended, so the stretch it began runs to now; `close`: the
 * session ended, which extends the last stretch only if it was at work a moment ago (one ended for it after hours of
 * quiet stopped when it went quiet).
 */
export function stretch(active: unknown, when: string, how: 'at' | 'until' | 'close'): [string, string][] {
  const list = (Array.isArray(active) ? active : []).filter((s): s is [string, string] => Array.isArray(s) && typeof s[0] === 'string' && typeof s[1] === 'string').map(([a, b]): [string, string] => [a, b]);
  const last = list.at(-1);
  const near = last && Date.parse(when) - Date.parse(last[1]) <= IDLE_MS;
  if (last && (how === 'until' || near)) last[1] = when > last[1] ? when : last[1];
  else if (how !== 'close') list.push([when, when]);
  return list.slice(-STRETCHES_KEPT);
}

/** The session was heard from: when, and as a sign of work. A turn that begins marks it busy until it ends. */
async function touch(ctx: KernelContext, run: string, how: 'at' | 'until' | 'close' | 'begin' = 'at'): Promise<void> {
  const at = now(ctx);
  const active = stretch((await itemOf(ctx, run))?.props.active, at, how === 'begin' ? 'at' : how);
  const busy = how === 'begin' ? { busy: true } : how === 'until' || how === 'close' ? { busy: false } : {};
  await operational(ctx, run, { props: { last_seen: at, active, ...busy } });
}

/**
 * A session that had gone quiet has been heard from, or has ended: the notice
 * that said so is no longer true, so it leaves what the human has to read. It
 * can be flagged again if it goes quiet again.
 */
async function heard(ctx: KernelContext, run: Item, why: string): Promise<void> {
  if (!run.props.stale_flagged) return;
  await operational(ctx, run.id, { unset: ['stale_flagged'] });
  const notices = (await ctx.reads({ quiet_notices: run.id })) as string[];
  if (notices.length) await bookkeep(ctx, 'agent:pelago', { ops: notices.map((id): Op => ({ op: 'update', id, status: 'read' })), reason: why });
}

/** A surface's session was heard from (a prompt begins a turn, a stop ends one): it is not quiet, whether or not it reports in itself. */
export async function sessionHeard(ctx: KernelContext, sessionId: string | undefined, turn?: 'begin' | 'until'): Promise<void> {
  const run = sessionId ? await resolveRun(ctx, sessionId, true) : undefined;
  if (!run) return;
  await touch(ctx, run.id, turn ?? 'at');
  await heard(ctx, run, `Session "${run.title}" was heard from again`);
}

/**
 * What a session has used so far, as the machine it runs on counted it (the
 * hook reads the session's own record). The session keeps the total; what is
 * new since the last count goes to the work it is on now, shared between
 * them when there is more than one. A measurement, not a fact someone
 * states: it is written as the session's last-seen is, with no change to
 * review and without making the work look newly confirmed.
 */
export async function recordUsage(ctx: KernelContext, sessionId: string | undefined, tokens: unknown): Promise<{ run: string; added: number; to: string[] } | undefined> {
  if (!sessionId || typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) return undefined;
  const run = await resolveRun(ctx, sessionId, true);
  if (!run) return undefined;
  const added = Math.round(tokens) - Number(run.props.tokens_used ?? 0);
  if (added <= 0) return { run: run.id, added: 0, to: [] };
  await operational(ctx, run.id, { add: { tokens_used: added } });
  const rows = (await ctx.reads({ works_of: run.id })) as { id: string; type: string }[];
  const work = rows.filter((w) => ctx.registry.type(w.type)?.fields.tokens_used);
  for (const w of work) await operational(ctx, w.id, { add: { tokens_used: Math.round(added / work.length) } });
  return { run: run.id, added, to: work.map((w) => w.id) };
}

export async function sessionUpdate(ctx: KernelContext, actor: Actor, input: { run: string; status?: 'running' | 'waiting'; note?: string; task?: string; branch?: string; title?: string; parent?: string }, shown: Shown[] = []) {
  const run = await resolveRun(ctx, input.run);
  if (!run) throw new Error(`No session "${input.run}"`);
  if (!run.is_open) throw new Error(`Session "${run.title}" has already ended`);
  // A session that learns only now which one started it says so: its run is tied to that one's.
  await parented(ctx, actor, run.id, input.parent ? await parentRun(ctx, input.parent) : undefined);
  await heard(ctx, run, `Session "${run.title}" reported in again`);
  // Its chat was renamed: what it is called follows, wherever it is named.
  await labelled(ctx, run, input.title, actorId(actor), shown);
  // A bare call is a heartbeat: it moves last_seen and leaves no event. A branch it has not said before is kept.
  if (!input.status && !input.note && !input.task && (!input.branch || input.branch === run.props.branch)) {
    await touch(ctx, run.id);
    return { run: run.id, status: run.status };
  }
  const ops: Op[] = [
    {
      op: 'update',
      id: run.id,
      status: input.status,
      body: input.note ? [run.body, `[${now(ctx)}] ${input.note}`].filter(Boolean).join('\n') : undefined,
      props: { last_seen: now(ctx), ...(input.branch && { branch: input.branch }) },
    },
  ];
  if (input.task) ops.push({ op: 'link', type: 'works_on', from: run.id, to: input.task });
  await bookkeep(ctx, actorId(actor), { ops, reason: input.note ?? `Session ${input.status ?? 'update'}` });
  await touch(ctx, run.id);
  // Work that is picked up with no estimate is the moment to give it one.
  const task = input.task ? await itemOf(ctx, input.task) : undefined;
  const unestimated = task && ctx.registry.type(task.type)?.fields.tokens_estimated && task.props.tokens_estimated == null;
  return {
    run: run.id,
    status: input.status ?? run.status,
    ...(unestimated && { estimate: `"${task.title}" has no estimate. Say how many tokens you expect it to take (one number: input and output together, not counting cached re-reads): change, update ${task.id}, props.tokens_estimated. What it actually uses is measured for you.` }),
  };
}

/** One beat of a session's story: what it concluded, the items that is about, and the ties it wants seen between them. */
export interface Beat {
  /** Its number in the story, from 1. */
  n: number;
  at: string;
  said: string;
  about: string[];
  links: { from: string; to: string; says: string }[];
  /** The beat this one takes back: what the session thought then and no longer does. */
  replaces?: number;
  /** Set on a beat a later one took back. */
  replaced_by?: number;
  /** What the session has found, said whole: the latest that stands is what its page opens on. */
  finding?: boolean;
  /** Set on a beat a rule on the reply's end asked with (packs/sessions/kernel/replies.ts): the rule, as pack.id. */
  asked?: string;
}
const BEATS_KEPT = 80;
const SAID_MAX = 280;
/** A finding is a few plain sentences: the point, what it rests on, what is left. */
const FINDING_MAX = 600;
const SAYS_MAX = 40;

/**
 * A session tells the story of its work: as it reasons, it adds a beat (what
 * it concluded and why, the items that is about, the ties between them it
 * wants seen), and the owner reads the story on the session's page, the
 * beats beside a small drawing of only those items. Chosen, not everything
 * touched. Kept on the run as its tokens are, written straight and not as a
 * change: it is the session's own account, and a change logged for every
 * beat would carry the whole story in each event.
 */
export async function tell(
  ctx: KernelContext,
  _actor: Actor,
  input: { run: string; said: string; about?: string[]; links?: { from: string; to: string; says: string }[]; replaces?: number; finding?: boolean; asked?: string },
) {
  const run = await resolveRun(ctx, input.run);
  if (!run) throw new Error(`No session "${input.run}"`);
  if (!run.is_open) throw new Error(`Session "${run.title}" has already ended`);
  const said = input.said.trim();
  if (!said) throw new Error('A beat says something: give said a sentence.');
  const most = input.finding ? FINDING_MAX : SAID_MAX;
  if (said.length > most)
    throw new Error(
      input.finding
        ? `A finding is a few plain sentences, ${most} characters at most (this is ${said.length}): the point, what it rests on, what is left.`
        : `A beat is a sentence or two, ${most} characters at most (this is ${said.length}). Say the point; what else there is goes in a note on the item.`,
    );
  const story = Array.isArray(run.props.story) ? (run.props.story as Beat[]) : [];
  if (story.length >= BEATS_KEPT) throw new Error(`This story already has ${BEATS_KEPT} beats. Take one back with replaces rather than adding: a story that long is no longer read.`);
  const links = (input.links ?? []).map((k) => ({ from: k.from, to: k.to, says: k.says.trim() }));
  for (const k of links) if (!k.says || k.says.length > SAYS_MAX) throw new Error(`A link says what ties the two in a few words, ${SAYS_MAX} characters at most: "${k.says}".`);
  // An end of a link is about what the beat is about, whether or not it was named there.
  const about = [...new Set([...(input.about ?? []), ...links.flatMap((k) => [k.from, k.to])])];
  if (about.length > 12) throw new Error('A beat is about a few items, 12 at most: tell another beat for the rest.');
  const found = ((await ctx.reads({ ids: about })) as Item[]).filter((f) => f.archived_at == null);
  const missing = about.filter((id) => !found.some((f) => f.id === id));
  if (missing.length) throw new Error(`No item ${missing.map((id) => `"${id}"`).join(', ')} to tell of. Name items by the ids the map gave them.`);
  if (input.replaces !== undefined) {
    const old = story.find((b) => b.n === input.replaces);
    if (!old) throw new Error(`There is no beat ${input.replaces} in this story to take back: it has ${story.length}.`);
    if (old.replaced_by) throw new Error(`Beat ${old.n} was already taken back by beat ${old.replaced_by}.`);
  }
  if (input.finding && !about.length) throw new Error('A finding names the items it is about (about, or the ends of links): they are its picture.');
  const beat: Beat = { n: story.length + 1, at: now(ctx), said, about, links, ...(input.replaces !== undefined && { replaces: input.replaces }), ...(input.finding && { finding: true }), ...(input.asked && { asked: input.asked }) };
  const next = [...story.map((b) => (b.n === input.replaces ? { ...b, replaced_by: beat.n } : b)), beat];
  await operational(ctx, run.id, { props: { story: next, last_seen: now(ctx) } });
  await touch(ctx, run.id);
  await heard(ctx, run, `Session "${run.title}" told of its work`);
  return { run: run.id, beat: beat.n, standing: next.filter((b) => !b.replaced_by).length };
}

/** A session's story as told: the run and its beats in order. The picture of it is the lens, started from the run (story). */
export async function story(ctx: KernelContext, input: Record<string, unknown>) {
  const key = String(input.run ?? '');
  const run = key ? await resolveRun(ctx, key) : undefined;
  if (!run) throw new Error(`No session "${key}": give run, a run id or a session id.`);
  const beats = Array.isArray(run.props.story) ? (run.props.story as Beat[]) : [];
  // What the page opens on: the latest finding that stands, else the latest beat the session said itself, not a rule.
  const standing = beats.filter((b) => !b.replaced_by);
  const found = standing.findLast((b) => b.finding) ?? standing.findLast((b) => !b.asked) ?? standing.at(-1);
  return { run: { id: run.id, title: run.title, status: run.status, open: run.is_open }, finding: found?.n ?? null, beats };
}

/** What ending a session takes. */
export type EndInput = {
  run: string;
  outcome?: 'finished' | 'failed' | 'cancelled';
  summary?: string;
  /** Open items the session vouches for as it found them. */
  still_true?: string[];
  /** Open items the session had nothing to do with and cannot check from where it is. */
  cannot_tell?: string[];
  /** Every open item not otherwise named is one the session cannot tell about. */
  cannot_tell_rest?: boolean;
  /** Ask the session about the repository's open work before letting it finish. */
  reconcile?: boolean;
  /** Said by the session itself: a chat's run then says where its work stands and waits, for the chat ends it, not its agent. */
  chat_goes_on?: boolean;
  /** Why its chat ended, as its client says it (clear, logout, exit, closed, archived, deleted): the chat is over, whoever says so. */
  reason?: string;
};

export async function sessionEnd(ctx: KernelContext, actor: Actor, input: EndInput, shown: Shown[] = []) {
  const run = await resolveRun(ctx, input.run);
  if (!run) throw new Error(`No session "${input.run}"`);
  if (!run.is_open) return { run: run.id, status: run.status, already_ended: true };
  const outcome = input.outcome ?? 'finished';
  const stays = Boolean(input.chat_goes_on) && isChat(run);
  // A chat that has said where its work stands and is then ended for it: what it said stands as its last word.
  const said_already = !stays && !input.reconcile && run.status === 'waiting' && isChat(run);
  const unsaid = outcome === 'finished' && !said_already ? await unreconciled(ctx, run) : [];
  const vouched = unsaid.filter((i) => input.still_true?.includes(i.id));
  // "Cannot tell" is an answer too: the item is left exactly as it was, last known true when it was, and the run says so.
  const named = unsaid.filter((i) => !vouched.includes(i) && input.cannot_tell?.includes(i.id));
  // What this session touched it looked at: the rest of it, unnamed, is not covered by cannot_tell_rest.
  const unknown = input.cannot_tell_rest ? unsaid.filter((i) => !vouched.includes(i) && (!i.touched || named.includes(i))) : named;
  // The rest are counted, not listed: a session that never looked at thirty items has nothing to say of each.
  const rest = unknown.length - named.length;
  const left = unsaid.filter((i) => !vouched.includes(i) && !unknown.includes(i));
  if (input.reconcile && left.length) {
    return {
      run: run.id,
      status: run.status,
      ended: false,
      unreconciled: left,
      note: 'Not ended yet. First, what you built and nobody has seen working: say so on the item (seen_working false, to_see); and what bit you that nothing can fix: an instruction about this repository, for: file:<glob>. These are open in the repository this session worked in or were touched by it (read, shown or changed: marked touched, and listed first), and nobody has changed them since it began. For each: if it is done or no longer as written, change it with change; if you checked it and it is still true as written, name its id in still_true; if this session had nothing to do with it and cannot check it from here, name its id in cannot_tell (or send cannot_tell_rest: true for all you have not otherwise named and did not touch), and do not vouch for what you did not look at. Then call report with action session_end again.',
    };
  }
  const said = [
    vouched.length && `Said still true: ${vouched.map((i) => `${i.title} (${i.id})`).join('; ')}.`,
    unknown.length && `Could not tell from here, left as found: ${[...named.map((i) => `${i.title} (${i.id})`), ...(rest ? [`${rest} ${named.length ? 'more' : rest === 1 ? 'item' : 'items'} it did not look at`] : [])].join('; ')}.`,
    // A session closed for it has said nothing of anything: past a few, the count says as much as the list.
    left.length && (left.length > 8 ? `Not reconciled: ${left.length} open items left unsaid.` : `Not reconciled, open and left unsaid: ${left.map((i) => `${i.title} (${i.id})`).join('; ')}.`),
  ].filter(Boolean);
  const summary = said_already ? '' : [input.summary, ...said].filter(Boolean).join('\n');
  // Vouching is said on the items too: an update that changes nothing marks each as checked now. It is the session's
  // own change, judged by the rules as any it sends.
  if (vouched.length) {
    await changeAs(ctx, actor, {
      ops: vouched.map((i): Op => ({ op: 'update', id: i.id })),
      reason: `Checked at the end of session "${run.title}": still true as written`,
      authority: { of: 'agent', basis: `Named in still_true when session ${run.id} ended` },
    });
  }
  // Whatever it held goes back first, so a finished session is never seen still keeping the lane.
  const held = (await ctx.reads({ links: { from: [run.id], types: ['holds'] } })) as { to_id: string }[];
  for (const h of held) await releaseAs(ctx, actor, { resource: h.to_id, holder: run.id, reason: `Session ${outcome}` });
  await touch(ctx, run.id, 'close');
  await keepTouched(ctx, run.id);
  const working = (await ctx.reads({ links: { from: [run.id], types: ['works_on'] } })) as { id: string }[];
  await bookkeep(ctx, actorId(actor), {
    ops: [
      { op: 'update', id: run.id, status: stays ? 'waiting' : outcome, body: summary ? [run.body, `[${now(ctx)}] ${outcome}: ${summary}`].filter(Boolean).join('\n') : undefined, ...(!stays && input.reason && { props: { ended_by: input.reason.slice(0, 40) } }) },
      ...working.map((w): Op => ({ op: 'unlink', relation: w.id })),
    ],
    reason: input.summary ?? `Session ${outcome}`,
  });
  await heard(ctx, run, `Session "${run.title}" ended`);
  // The owner's page closes its tab (ui/tab-life.js); a page that missed this finds it ended when it next reads the sessions.
  // One that stays, waiting, lets its tab go until it next shows something.
  shown.push({ actor: actorId(actor), did: stays ? 'waiting' : (input.reason ?? 'ended'), run: run.id, ...(stays ? { rests: true as const } : { ends: true as const }) });
  return { run: run.id, status: stays ? 'waiting' : outcome, released: held.length, note: stays ? 'Kept. The session stays open, under its name, until its chat ends.' : undefined };
}
