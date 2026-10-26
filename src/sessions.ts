// Sessions: an agent session (or automation run) registers itself in the map
// as a sys.run, says what it is working on, and takes the exclusive resources
// that work needs. These writes skip the proposal step, like claim and
// release: they are the session's own operational state, not facts about the
// world, and coordination that waits for approval is no coordination.

import { livesIn, livesInFor, placeFor } from './places.ts';
import { actorId, type Actor, type Entity, type Archipelago, type Op } from './pelago.ts';
import { askView, canAsk } from './askview.ts'; import { scopeWithin } from './within.ts';
import { heldResources } from './blocking.ts';
import { toConfirm } from './confirm.ts'; import { commitRule } from './commit-rule.ts';
import { STALE_DAYS } from './attention.ts';
import { VIEWS } from './views.ts'; import type { StartedBy } from './launcher.ts'; import { keepTouched } from './touched.ts'; import { unreconciled } from './reconcile.ts';

const now = () => new Date().toISOString();

/** Find a run by its entity id or by the session id its surface gave it. */
export async function resolveRun(l: Archipelago, key: string, openOnly = false): Promise<Entity | undefined> {
  const byId = await l.entity(key);
  if (byId && l.registry.isA(byId.type, 'sys.run')) return byId;
  const { rows } = await l.db.query<Entity>(
    `select * from entity where type = any($1::text[]) and props->>'session_id' = $2 and archived_at is null
       and ($3::boolean is false or is_open) order by is_open desc, created_at desc limit 1`,
    [l.registry.family('sys.run'), key, openOnly],
  );
  return rows[0];
}

/**
 * Whether a hook may speak for the session it names, when the token it came with is within some items: a session
 * that is starting has to be in a place that is theirs, and any other has to be one that was registered there.
 */
export async function hookWithin(l: Archipelago, within: string[], input: { session_id?: string; cwd?: string; remote?: string }, starting: boolean): Promise<boolean> {
  const [scope, place] = [await scopeWithin(l, within), starting ? await placeFor(l, { cwd: input.cwd, remote: typeof input.remote === 'string' ? input.remote : undefined }) : undefined];
  if (starting) return Boolean(place && scope.has(place.id));
  const run = input.session_id ? await resolveRun(l, input.session_id, true) : undefined;
  if (!run) return true; // nothing to speak for: the hook does nothing either way
  const { rows } = await l.db.query(`select 1 from relation where type = any($3::text[]) and from_id = $1 and to_id = any($2::text[]) and valid_to is null`, [run.id, [...scope], livesIn(l)]);
  return rows.length > 0;
}

/** When a surface's session registered here, if it did and is still open. */
export async function sessionBegan(l: Archipelago, sessionId: string | undefined): Promise<Date | undefined> {
  const run = sessionId ? await resolveRun(l, sessionId, true) : undefined;
  return run && new Date(run.created_at);
}

export async function sessionStart(
  l: Archipelago,
  actor: Actor,
  input: { title?: string; surface?: string; cwd?: string; remote?: string; session_id?: string; task?: string; branch?: string },
) {
  // A surface may announce the same session more than once (resume, compact).
  if (input.session_id) {
    const existing = await resolveRun(l, input.session_id, true);
    if (existing) {
      await touch(l, existing.id);
      // Its repository is said again: the hook tells a resumed session where things stand, as it told it at first.
      return { run: existing.id, status: existing.status, resumed: true, repo: (await placeFor(l, input)) ?? undefined };
    }
  }
  const task = input.task ? await l.entity(input.task) : undefined;
  if (input.task && !task) throw new Error(`No item "${input.task}" to work on`);
  const repo = await placeFor(l, input);

  const props: Record<string, unknown> = { last_seen: now(), active: stretch([], now(), 'at') };
  for (const k of ['surface', 'cwd', 'session_id', 'branch'] as const) if (input[k]) props[k] = input[k];
  const title = input.title ?? (task ? `Session: ${task.title}` : `Session in ${repo?.title ?? input.cwd ?? 'unknown folder'}`);
  const ops: Op[] = [{ op: 'create', ref: 'run', type: 'sys.run', title, status: 'running', props }];
  if (task) ops.push({ op: 'link', type: 'sys.works_on', from: 'run', to: task.id });
  if (repo) ops.push({ op: 'link', type: livesInFor(l, repo.type), from: 'run', to: repo.id });
  const { created } = await l.apply(actorId(actor), { ops, reason: 'Session started' });
  const run = created.run;

  // Take every exclusive resource the task needs, or say who has it.
  const claimed: string[] = [];
  const blocked: { resource: string; title: string; why: string }[] = [];
  if (task) {
    const { rows: needed } = await l.db.query<Entity>(
      `select res.* from relation n join entity res on res.id = n.to_id
       where n.type = any($2::text[]) and n.from_id = $1 and n.valid_to is null and res.archived_at is null`,
      [task.id, l.registry.relationFamily('needs')],
    );
    for (const res of needed) {
      try {
        if (l.registry.capacity(res) === Infinity && res.status === 'available') continue;
        await l.claim(actor, { resource: res.id, holder: run, for: task.id, reason: `Needed for "${task.title}"` });
        claimed.push(res.title);
      } catch (err) {
        blocked.push({ resource: res.id, title: res.title, why: (err as Error).message });
      }
    }
  }
  if (blocked.length) await l.apply(actorId(actor), { ops: [{ op: 'update', id: run, status: 'waiting' }], reason: `Waiting on ${blocked.map((b) => b.title).join(', ')}` });

  return {
    run,
    status: blocked.length ? 'waiting' : 'running',
    repo: repo && { id: repo.id, title: repo.title },
    claimed,
    blocked,
    note: blocked.length
      ? 'Do not start work that needs the resources listed under blocked. Take work that does not need them, or wait.'
      : 'Call report with action session_update and a note when something worth knowing happens, and report with action session_end when you finish.',
    commit: task ? commitRule(task.id) : undefined,
  };
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
async function touch(l: Archipelago, run: string, how: 'at' | 'until' | 'close' | 'begin' = 'at'): Promise<void> {
  const at = now();
  const { rows } = await l.db.query<{ active: unknown }>(`select props -> 'active' as active from entity where id = $1`, [run]);
  const active = stretch(rows[0]?.active, at, how === 'begin' ? 'at' : how);
  const busy = how === 'begin' ? { busy: true } : how === 'until' || how === 'close' ? { busy: false } : {};
  await l.operational(run, { props: { last_seen: at, active, ...busy } });
}

/**
 * A session that had gone quiet has been heard from, or has ended: the notice
 * that said so is no longer true, so it leaves what the human has to read. It
 * can be flagged again if it goes quiet again.
 */
async function heard(l: Archipelago, run: Entity, why: string): Promise<void> {
  if (!run.props.stale_flagged) return;
  await l.operational(run.id, { unset: ['stale_flagged'] });
  const { rows } = await l.db.query<{ id: string }>(
    `select n.id from entity n join relation r on r.from_id = n.id and r.type = 'about' and r.valid_to is null
     where r.to_id = $1 and n.type = 'sys.notification' and n.is_open and n.archived_at is null and n.props->>'from' in ('agent:pelago', 'agent:lattice')`,
    [run.id],
  );
  if (rows.length) await l.apply('agent:pelago', { ops: rows.map((n): Op => ({ op: 'update', id: n.id, status: 'read' })), reason: why });
}

/** A surface's session was heard from (a prompt begins a turn, a stop ends one): it is not quiet, whether or not it reports in itself. */
export async function sessionHeard(l: Archipelago, sessionId: string | undefined, turn?: 'begin' | 'until'): Promise<void> {
  const run = sessionId ? await resolveRun(l, sessionId, true) : undefined;
  if (!run) return;
  await touch(l, run.id, turn ?? 'at');
  await heard(l, run, `Session "${run.title}" was heard from again`);
}

/**
 * What a session has used so far, as the machine it runs on counted it (the
 * hook reads the session's own record). The session keeps the total; what is
 * new since the last count goes to the work it is on now, shared between
 * them when there is more than one. A measurement, not a fact someone
 * states: it is written as the session's last-seen is, with no change to
 * review and without making the work look newly confirmed.
 */
export async function recordUsage(l: Archipelago, sessionId: string | undefined, tokens: unknown): Promise<{ run: string; added: number; to: string[] } | undefined> {
  if (!sessionId || typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) return undefined;
  const run = await resolveRun(l, sessionId, true);
  if (!run) return undefined;
  const added = Math.round(tokens) - Number(run.props.tokens_used ?? 0);
  if (added <= 0) return { run: run.id, added: 0, to: [] };
  await l.operational(run.id, { add: { tokens_used: added } });
  const { rows } = await l.db.query<{ id: string; type: string }>(
    `select e.id, e.type from relation r join entity e on e.id = r.to_id where r.type = 'sys.works_on' and r.from_id = $1 and r.valid_to is null and e.archived_at is null`,
    [run.id],
  );
  const work = rows.filter((w) => l.registry.type(w.type)?.fields.tokens_used);
  for (const w of work) await l.operational(w.id, { add: { tokens_used: Math.round(added / work.length) } });
  return { run: run.id, added, to: work.map((w) => w.id) };
}

/**
 * A run that happened where Archipelago cannot watch it (the agent in GitHub
 * Actions that reads a push, or re-checks the map) says so once it is over:
 * what it was, how it ended and what it used. It is kept as a run that has
 * ended, in the repository it ran for. Told twice of the same run (its link
 * is the same), it is recorded once.
 */
export async function recordRun(
  l: Archipelago,
  actor: Actor,
  input: { repo: string; title: string; ok?: boolean; tokens?: number; cost_usd?: number; turns?: number; link?: string; summary?: string; surface?: string; started_by?: StartedBy },
) {
  const repo = /^e_[a-z0-9]{8}$/.test(input.repo) ? await l.entity(input.repo) : await placeFor(l, { remote: input.repo });
  if (!repo) throw new Error(`No repository "${input.repo}" in the map`);
  if (input.link) {
    const { rows } = await l.db.query<{ id: string }>(`select id from entity where type = any($1::text[]) and props->>'link' = $2 and title = $3 and archived_at is null limit 1`, [l.registry.family('sys.run'), input.link, input.title]);
    if (rows.length) return { run: rows[0].id, recorded: false };
  }
  const number = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined);
  const props: Record<string, unknown> = { surface: input.surface ?? 'github-actions', last_seen: now() };
  if (number(input.tokens) !== undefined) props.tokens_used = Math.round(input.tokens!);
  if (number(input.cost_usd) !== undefined) props.cost_usd = Math.round(input.cost_usd! * 10_000) / 10_000;
  if (number(input.turns) !== undefined) props.turns = input.turns;
  if (input.link) props.link = input.link; if (input.started_by) props.started_by = input.started_by;
  const { created } = await l.apply(actorId(actor), {
    ops: [
      { op: 'create', ref: 'run', type: 'sys.run', title: input.title, status: input.ok === false ? 'failed' : 'finished', body: input.summary?.slice(0, 4000), props },
      { op: 'link', type: livesInFor(l, repo.type), from: 'run', to: repo.id },
    ],
    reason: 'Run reported',
  });
  return { run: created.run, recorded: true };
}

export async function sessionUpdate(l: Archipelago, actor: Actor, input: { run: string; status?: 'running' | 'waiting'; note?: string; task?: string; branch?: string }) {
  const run = await resolveRun(l, input.run);
  if (!run) throw new Error(`No session "${input.run}"`);
  if (!run.is_open) throw new Error(`Session "${run.title}" has already ended`);
  await heard(l, run, `Session "${run.title}" reported in again`);
  // A bare call is a heartbeat: it moves last_seen and leaves no event. A branch it has not said before is kept.
  if (!input.status && !input.note && !input.task && (!input.branch || input.branch === run.props.branch)) {
    await touch(l, run.id);
    return { run: run.id, status: run.status };
  }
  const ops: Op[] = [
    {
      op: 'update',
      id: run.id,
      status: input.status,
      body: input.note ? [run.body, `[${now()}] ${input.note}`].filter(Boolean).join('\n') : undefined,
      props: { last_seen: now(), ...(input.branch && { branch: input.branch }) },
    },
  ];
  if (input.task) ops.push({ op: 'link', type: 'sys.works_on', from: run.id, to: input.task });
  await l.apply(actorId(actor), { ops, reason: input.note ?? `Session ${input.status ?? 'update'}` });
  await touch(l, run.id);
  // Work that is picked up with no estimate is the moment to give it one.
  const task = input.task ? await l.entity(input.task) : undefined;
  const unestimated = task && l.registry.type(task.type)?.fields.tokens_estimated && task.props.tokens_estimated == null;
  return {
    run: run.id,
    status: input.status ?? run.status,
    ...(task && { commit: commitRule(task.id) }),
    ...(unestimated && { estimate: `"${task.title}" has no estimate. Say how many tokens you expect it to take (input and output, not counting cached re-reads): change, update ${task.id}, props.tokens_estimated. What it actually uses is measured for you.` }),
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
  l: Archipelago,
  _actor: Actor,
  input: { run: string; said: string; about?: string[]; links?: { from: string; to: string; says: string }[]; replaces?: number; finding?: boolean },
) {
  const run = await resolveRun(l, input.run);
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
  const { rows: found } = await l.db.query<{ id: string }>(`select id from entity where id = any($1::text[]) and archived_at is null`, [about]);
  const missing = about.filter((id) => !found.some((f) => f.id === id));
  if (missing.length) throw new Error(`No item ${missing.map((id) => `"${id}"`).join(', ')} to tell of. Name items by the ids the map gave them.`);
  if (input.replaces !== undefined) {
    const old = story.find((b) => b.n === input.replaces);
    if (!old) throw new Error(`There is no beat ${input.replaces} in this story to take back: it has ${story.length}.`);
    if (old.replaced_by) throw new Error(`Beat ${old.n} was already taken back by beat ${old.replaced_by}.`);
  }
  if (input.finding && !about.length) throw new Error('A finding names the items it is about (about, or the ends of links): they are its picture.');
  const beat: Beat = { n: story.length + 1, at: now(), said, about, links, ...(input.replaces !== undefined && { replaces: input.replaces }), ...(input.finding && { finding: true }) };
  const next = [...story.map((b) => (b.n === input.replaces ? { ...b, replaced_by: beat.n } : b)), beat];
  await l.operational(run.id, { props: { story: next, last_seen: now() } });
  await touch(l, run.id);
  await heard(l, run, `Session "${run.title}" told of its work`);
  return { run: run.id, beat: beat.n, standing: next.filter((b) => !b.replaced_by).length };
}

/** A session's story as told: the run and its beats in order. The picture of it is the lens, started from the run (story). */
export async function story(l: Archipelago, input: Record<string, unknown>) {
  const key = String(input.run ?? '');
  const run = key ? await resolveRun(l, key) : undefined;
  if (!run) throw new Error(`No session "${key}": give run, a run id or a session id.`);
  const beats = Array.isArray(run.props.story) ? (run.props.story as Beat[]) : [];
  // What the page opens on: the latest finding that stands, else the latest beat that does.
  const standing = beats.filter((b) => !b.replaced_by);
  const found = standing.findLast((b) => b.finding) ?? standing.at(-1);
  return { run: { id: run.id, title: run.title, status: run.status, open: run.is_open }, finding: found?.n ?? null, beats };
}

// Asked like any standing question; kept here, beside what writes it.
VIEWS.story = {
  description:
    'The story a session told of its work (report, action tell): its beats in order (n, said, about, links; one taken back says replaced_by; a finding says finding), and which beat its page opens on (finding: the latest finding that stands, else the latest beat). Its page draws what its finding is about with the flat lens. Params: run (required): a run id or session id.',
  run: story,
};

export async function sessionEnd(
  l: Archipelago,
  actor: Actor,
  input: {
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
  },
) {
  const run = await resolveRun(l, input.run);
  if (!run) throw new Error(`No session "${input.run}"`);
  if (!run.is_open) return { run: run.id, status: run.status, already_ended: true };
  const outcome = input.outcome ?? 'finished';
  const unsaid = outcome === 'finished' ? await unreconciled(l, run) : [];
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
      note: 'Not ended yet. These are open in the repository this session worked in or were touched by it (read, shown or changed: marked touched, and listed first), and nobody has changed them since it began. For each: if it is done or no longer as written, change it with change; if you checked it and it is still true as written, name its id in still_true; if this session had nothing to do with it and cannot check it from here, name its id in cannot_tell (or send cannot_tell_rest: true for all you have not otherwise named and did not touch), and do not vouch for what you did not look at. Then call report with action session_end again.',
    };
  }
  const said = [
    vouched.length && `Said still true: ${vouched.map((i) => `${i.title} (${i.id})`).join('; ')}.`,
    unknown.length && `Could not tell from here, left as found: ${[...named.map((i) => `${i.title} (${i.id})`), ...(rest ? [`${rest} ${named.length ? 'more' : rest === 1 ? 'item' : 'items'} it did not look at`] : [])].join('; ')}.`,
    // A session closed for it has said nothing of anything: past a few, the count says as much as the list.
    left.length && (left.length > 8 ? `Not reconciled: ${left.length} open items left unsaid.` : `Not reconciled, open and left unsaid: ${left.map((i) => `${i.title} (${i.id})`).join('; ')}.`),
  ].filter(Boolean);
  const summary = [input.summary, ...said].filter(Boolean).join('\n');
  // Vouching is said on the items too: an update that changes nothing marks each as checked now.
  if (vouched.length) {
    await l.change(actor, {
      ops: vouched.map((i): Op => ({ op: 'update', id: i.id })),
      reason: `Checked at the end of session "${run.title}": still true as written`,
      authority: { of: 'agent', basis: `Named in still_true when session ${run.id} ended` },
    });
  }
  // Whatever it held goes back first, so a finished session is never seen still keeping the lane.
  const { rows: held } = await l.db.query<{ to_id: string }>(`select to_id from relation where type = 'holds' and from_id = $1 and valid_to is null`, [run.id]);
  for (const h of held) await l.release(actor, { resource: h.to_id, holder: run.id, reason: `Session ${outcome}` });
  await touch(l, run.id, 'close');
  await keepTouched(l, run.id);
  const { rows: working } = await l.db.query<{ id: string }>(`select id from relation where type = 'sys.works_on' and from_id = $1 and valid_to is null`, [run.id]);
  await l.apply(actorId(actor), {
    ops: [
      { op: 'update', id: run.id, status: outcome, body: summary ? [run.body, `[${now()}] ${outcome}: ${summary}`].filter(Boolean).join('\n') : undefined },
      ...working.map((w): Op => ({ op: 'unlink', relation: w.id })),
    ],
    reason: input.summary ?? `Session ${outcome}`,
  });
  await heard(l, run, `Session "${run.title}" ended`);
  return { run: run.id, status: outcome, released: held.length };
}

/**
 * A Claude Code SessionStart hook: register the session and return the text
 * to put in front of the model, so it starts knowing what the map knows.
 */
export async function hookSessionStart(l: Archipelago, input: { session_id?: string; cwd?: string; remote?: string }): Promise<string> {
  const started = await sessionStart(l, { kind: 'agent', name: 'claude-code' }, { session_id: input.session_id, cwd: input.cwd, remote: typeof input.remote === 'string' ? input.remote : undefined, surface: 'claude-code' });
  const lines = [`This session is registered in Archipelago, the owner's map of work and dependencies, as run ${started.run}.`];
  const repo = 'repo' in started ? started.repo : undefined;
  if (repo) lines.push(`Repository: ${repo.title} (${repo.id}).`);
  // Where the work there stands is the place's pack's to say: a repository's, the software pack's views.
  if (repo && canAsk(l, 'repo_work') && canAsk(l, 'handoff')) {
    const work = (await askView(l, { kind: 'agent', name: 'claude-code' }, 'repo_work', { repo: repo.id })) as { ready: { id: string; title: string; type: string; last_confirmed: string | Date }[]; blocked: { id: string; title: string; waiting_on: (string | undefined)[] }[] };
    // Where things stand is read off the map; the session is told how much has moved since someone last wrote it down.
    const stand = (await askView(l, { kind: 'agent', name: 'claude-code' }, 'handoff', { repo: repo.id })) as { note: { id: string; title: string; written: string } | null; since_then: Record<'pushes' | 'settled' | 'opened' | 'sessions', unknown[]> & { counts: Record<'pushes' | 'settled' | 'opened' | 'sessions', number> }; to_shape?: { hubs: { id: string; title: string; inside: number }[] } };
    const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
    const then = stand.since_then;
    const from = stand.note ? `Its note, "${stand.note.title}" (${stand.note.id}), was written ${new Date(stand.note.written).toISOString().slice(0, 10)}; since then` : 'Nobody has written a handoff note here; in the last week';
    lines.push(`Where things stand: view "handoff" with repo ${repo.id}. ${from}: ${n(then.counts.pushes, 'push', 'pushes')}, ${n(then.counts.settled, 'item')} settled, ${n(then.counts.opened, 'item')} opened, ${n(then.counts.sessions, 'session')} ended.`);
    const kind = (t: { type: string }) => `${l.registry.type(t.type)?.title ?? t.type}: `;
    // What nobody has touched for a while is said to be so: it may no longer be true.
    const age = (t: { last_confirmed: string | Date }) => {
      const days = Math.floor((Date.now() - new Date(t.last_confirmed).getTime()) / 86_400_000);
      return days >= STALE_DAYS ? `, not confirmed for ${days} days: check it before relying on it` : '';
    };
    if (work.ready.length) lines.push('', 'Open work and issues here that nothing blocks:', ...work.ready.slice(0, 15).map((t) => `- ${kind(t)}${t.title} (${t.id})${age(t)}`));
    if (work.blocked.length) lines.push('', 'Blocked work here:', ...work.blocked.slice(0, 15).map((t) => `- ${t.title} (${t.id}), waiting on: ${t.waiting_on.join('; ')}`));
    // Work that is owed though nobody wrote it down: what has grown into the hub of its problem and has no view of its own.
    const owed = 'to_shape' in stand ? stand.to_shape!.hubs : [];
    if (owed.length)
      lines.push(
        '',
        'Hubs here with no view of their own (each holds enough to be the hub of its problem; when you work in one, give it its views: lens items about it, named for the questions they answer. View "hubs" says how much each holds):',
        ...owed.slice(0, 8).map((h) => `- ${h.title} (${h.id}), holding ${h.inside}`),
      );
  } else if (!repo) {
    lines.push(`Archipelago does not know a repository for this folder${input.remote ? ` (a checkout of ${input.remote})` : ''}. If its work belongs in the map, give a repository there this address as its remote.`);
  }
  // The owner is here, in chat, and mostly nowhere else: what agents settled since they last answered is put to them now.
  const ask = await toConfirm(l, { limit: 15 });
  const judged = ask.questions.filter((q) => !q.on.startsWith('the owner'));
  if (ask.on_agents_judgment)
    lines.push(
      '',
      `For the owner, in your first reply: since they last looked, agents have settled ${ask.on_agents_judgment} ${ask.on_agents_judgment === 1 ? 'question' : 'questions'} on their own judgment${ask.on_owners_word ? ` (and recorded ${ask.on_owners_word} more as the owner's own answers in chat: say how many, and list them only if asked, with query "attention", reason to_confirm)` : ''}. Show them these, a line for each, and ask them to confirm or correct. When they have answered, call settle with action confirmed, upto ${ask.upto} and what they said; change or reopen what they correct.`,
      ...judged.map((q) => `- ${q.title}: ${q.answer} (${q.id})`),
      ...(ask.on_agents_judgment > judged.length ? [`- and ${ask.on_agents_judgment - judged.length} more: query "attention" with person "me" and reasons ["to_confirm"].`] : []),
    );
  const [heldNow, { rows: holdable }] = await Promise.all([heldResources(l), l.db.query<Entity>(`select * from entity where type = any($1::text[]) and is_open and archived_at is null`, [l.registry.having('capacity')])]);
  for (const res of holdable.filter((one) => l.registry.capacity(one) !== Infinity)) {
    const held = heldNow.find((h) => h.resource === res.id);
    lines.push('', `Exclusive resource "${res.title}" (${res.id}) is ${held ? `HELD by ${held.held_by_title}: do not use it` : 'free'}. Claim it with the pelago assign tool, action claim (holder ${started.run}), before using it, and give it back with revise, action release, after.`);
  }
  lines.push(
    '',
    'When you take on a task that has no estimate, give it one: how many tokens you expect it to take (props.tokens_estimated, with change). What is actually used is measured from this session and shown beside it.',
    `If the pelago MCP tools are available (query reads, change writes, and every other action is called under its verb by name: report with action tell): when you take on one of these, call report with action session_update and its id as task; as you reason about the work, tell its story with report, action tell (run ${started.run}): a beat for each thing you conclude, the items it is about and the ties between them, so the owner sees what you see; report session_update with a note for anything the owner should know; propose changes to the map with change. Before you finish, call report with action session_end and a summary: it shows you what is still open here that nobody has changed since you began, and asks you to change each, say it is still true, or say you cannot tell from here. A session that ends without it is closed for you and recorded as not reconciled.`,
    'When Archipelago itself gets in your way (a tool that fails or misleads, a workaround, an answer that is stale or too big, something the owner finds bad in its screens), record it on the map as an issue when it happens, after searching for it: say what you were doing, what happened, and what would have made it smooth. That is how it gets fixed.',
    'Keep the map true: when what you do or find settles something still open here (a task done, an experiment run, a decision made in practice), change its status with the outcome and the evidence rather than leaving a note. Closing a decision or hypothesis waits for the owner to confirm unless this workspace applies agents’ changes as made, so send the answer with what was chosen and why.',
  );
  return lines.join('\n');
}

export async function hookSessionEnd(l: Archipelago, input: { session_id?: string; reason?: string }): Promise<void> {
  if (!input.session_id) return;
  const run = await resolveRun(l, input.session_id, true);
  if (run) await sessionEnd(l, { kind: 'agent', name: 'claude-code' }, { run: run.id, outcome: 'finished', summary: input.reason ? `Session ended (${input.reason})` : undefined });
}
