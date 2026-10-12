// Sessions: an agent session (or automation run) registers itself in the map
// as a sys.run, says what it is working on, and takes the exclusive resources
// that work needs. These writes skip the proposal step, like claim and
// release: they are the session's own operational state, not facts about the
// world, and coordination that waits for approval is no coordination.

import { repoByName, repoName } from './github.ts';
import { actorId, type Actor, type Entity, type Lattice, type Op } from './lattice.ts';
import { blockGraph, handoff, toConfirm, UNCONFIRMED_DAYS, VIEWS } from './views.ts';

const now = () => new Date().toISOString();
const norm = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();

/** Find a run by its entity id or by the session id its surface gave it. */
async function resolveRun(l: Lattice, key: string, openOnly = false): Promise<Entity | undefined> {
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
 * The repository a session is in, if the map knows one: the one cloned from
 * this address, which is the same on every machine, or failing that the one
 * whose checkout on this machine contains the directory.
 */
async function repoFor(l: Lattice, cwd: string | undefined, remote?: string): Promise<Entity | undefined> {
  if (!l.registry.type('software.repo')) return undefined;
  const named = remote ? await repoByName(l, repoName(remote)) : undefined;
  if (named || !cwd) return named;
  const { rows } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null and props ? 'path'`, [
    l.registry.family('software.repo'),
  ]);
  const here = norm(cwd);
  return rows
    .filter((r) => here === norm(r.props.path as string) || here.startsWith(norm(r.props.path as string) + '/'))
    .sort((a, b) => (b.props.path as string).length - (a.props.path as string).length)[0];
}

/** When a surface's session registered here, if it did and is still open. */
export async function sessionBegan(l: Lattice, sessionId: string | undefined): Promise<Date | undefined> {
  const run = sessionId ? await resolveRun(l, sessionId, true) : undefined;
  return run && new Date(run.created_at);
}

export async function sessionStart(
  l: Lattice,
  actor: Actor,
  input: { title?: string; surface?: string; cwd?: string; remote?: string; session_id?: string; task?: string },
) {
  // A surface may announce the same session more than once (resume, compact).
  if (input.session_id) {
    const existing = await resolveRun(l, input.session_id, true);
    if (existing) {
      await touch(l, existing.id);
      return { run: existing.id, status: existing.status, resumed: true };
    }
  }
  const task = input.task ? await l.entity(input.task) : undefined;
  if (input.task && !task) throw new Error(`No entity "${input.task}" to work on`);
  const repo = await repoFor(l, input.cwd, input.remote);

  const props: Record<string, unknown> = { last_seen: now() };
  if (input.surface) props.surface = input.surface;
  if (input.cwd) props.cwd = input.cwd;
  if (input.session_id) props.session_id = input.session_id;
  const title = input.title ?? (task ? `Session: ${task.title}` : `Session in ${repo?.title ?? input.cwd ?? 'unknown folder'}`);
  const ops: Op[] = [{ op: 'create', ref: 'run', type: 'sys.run', title, status: 'running', props }];
  if (task) ops.push({ op: 'link', type: 'sys.works_on', from: 'run', to: task.id });
  if (repo) ops.push({ op: 'link', type: 'software.lives_in', from: 'run', to: repo.id });
  const { created } = await l.apply(actorId(actor), { ops, reason: 'Session started' });
  const run = created.run;

  // Take every exclusive resource the task needs, or say who has it.
  const claimed: string[] = [];
  const blocked: { resource: string; title: string; why: string }[] = [];
  if (task) {
    const { rows: needed } = await l.db.query<Entity>(
      `select res.* from relation n join entity res on res.id = n.to_id
       where n.type = 'needs' and n.from_id = $1 and n.valid_to is null and res.archived_at is null`,
      [task.id],
    );
    for (const res of needed) {
      try {
        if (res.props.exclusive === false && res.status === 'available') continue;
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
      : 'Call session_update with a note when something worth knowing happens, and session_end when you finish.',
  };
}

async function touch(l: Lattice, run: string): Promise<void> {
  await l.db.query(`update entity set props = props || jsonb_build_object('last_seen', $2::text) where id = $1`, [run, now()]);
}

/**
 * A session that had gone quiet has been heard from, or has ended: the notice
 * that said so is no longer true, so it leaves what the human has to read. It
 * can be flagged again if it goes quiet again.
 */
async function heard(l: Lattice, run: Entity, why: string): Promise<void> {
  if (!run.props.stale_flagged) return;
  await l.db.query(`update entity set props = props - 'stale_flagged' where id = $1`, [run.id]);
  const { rows } = await l.db.query<{ id: string }>(
    `select n.id from entity n join relation r on r.from_id = n.id and r.type = 'about' and r.valid_to is null
     where r.to_id = $1 and n.type = 'sys.notification' and n.is_open and n.archived_at is null and n.props->>'from' = 'agent:lattice'`,
    [run.id],
  );
  if (rows.length) await l.apply('agent:lattice', { ops: rows.map((n): Op => ({ op: 'update', id: n.id, status: 'read' })), reason: why });
}

/** A surface's session was heard from (a prompt, say): it is not quiet, whether or not it reports in itself. */
export async function sessionHeard(l: Lattice, sessionId: string | undefined): Promise<void> {
  const run = sessionId ? await resolveRun(l, sessionId, true) : undefined;
  if (!run) return;
  await touch(l, run.id);
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
export async function recordUsage(l: Lattice, sessionId: string | undefined, tokens: unknown): Promise<{ run: string; added: number; to: string[] } | undefined> {
  if (!sessionId || typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens <= 0) return undefined;
  const run = await resolveRun(l, sessionId, true);
  if (!run) return undefined;
  const added = Math.round(tokens) - Number(run.props.tokens_used ?? 0);
  if (added <= 0) return { run: run.id, added: 0, to: [] };
  const set = `update entity set props = props || jsonb_build_object('tokens_used', coalesce((props->>'tokens_used')::numeric, 0) + $2::numeric) where id = $1`;
  await l.db.query(set, [run.id, added]);
  const { rows } = await l.db.query<{ id: string; type: string }>(
    `select e.id, e.type from relation r join entity e on e.id = r.to_id where r.type = 'sys.works_on' and r.from_id = $1 and r.valid_to is null and e.archived_at is null`,
    [run.id],
  );
  const work = rows.filter((w) => l.registry.type(w.type)?.fields.tokens_used);
  for (const w of work) await l.db.query(set, [w.id, Math.round(added / work.length)]);
  return { run: run.id, added, to: work.map((w) => w.id) };
}

/**
 * A run that happened where Lattice cannot watch it (the agent in GitHub
 * Actions that reads a push, or re-checks the map) says so once it is over:
 * what it was, how it ended and what it used. It is kept as a run that has
 * ended, in the repository it ran for. Told twice of the same run (its link
 * is the same), it is recorded once.
 */
export async function recordRun(
  l: Lattice,
  actor: Actor,
  input: { repo: string; title: string; ok?: boolean; tokens?: number; cost_usd?: number; turns?: number; link?: string; summary?: string; surface?: string },
) {
  const repo = /^e_[a-z0-9]{8}$/.test(input.repo) ? await l.entity(input.repo) : await repoByName(l, repoName(input.repo));
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
  if (input.link) props.link = input.link;
  const { created } = await l.apply(actorId(actor), {
    ops: [
      { op: 'create', ref: 'run', type: 'sys.run', title: input.title, status: input.ok === false ? 'failed' : 'finished', body: input.summary?.slice(0, 4000), props },
      { op: 'link', type: 'software.lives_in', from: 'run', to: repo.id },
    ],
    reason: 'Run reported',
  });
  return { run: created.run, recorded: true };
}

export async function sessionUpdate(l: Lattice, actor: Actor, input: { run: string; status?: 'running' | 'waiting'; note?: string; task?: string }) {
  const run = await resolveRun(l, input.run);
  if (!run) throw new Error(`No session "${input.run}"`);
  if (!run.is_open) throw new Error(`Session "${run.title}" has already ended`);
  await heard(l, run, `Session "${run.title}" reported in again`);
  // A bare call is a heartbeat: it moves last_seen and leaves no event.
  if (!input.status && !input.note && !input.task) {
    await touch(l, run.id);
    return { run: run.id, status: run.status };
  }
  const ops: Op[] = [
    {
      op: 'update',
      id: run.id,
      status: input.status,
      body: input.note ? [run.body, `[${now()}] ${input.note}`].filter(Boolean).join('\n') : undefined,
      props: { last_seen: now() },
    },
  ];
  if (input.task) ops.push({ op: 'link', type: 'sys.works_on', from: run.id, to: input.task });
  await l.apply(actorId(actor), { ops, reason: input.note ?? `Session ${input.status ?? 'update'}` });
  // Work that is picked up with no estimate is the moment to give it one.
  const task = input.task ? await l.entity(input.task) : undefined;
  const unestimated = task && l.registry.type(task.type)?.fields.tokens_estimated && task.props.tokens_estimated == null;
  return {
    run: run.id,
    status: input.status ?? run.status,
    ...(unestimated && { estimate: `"${task.title}" has no estimate. Say how many tokens you expect it to take (input and output, not counting cached re-reads): change, update ${task.id}, props.tokens_estimated. What it actually uses is measured for you.` }),
  };
}

type Item = { id: string; type: string; title: string; status: string };

/**
 * What a session has left unsaid: the open work of the repository it ran in
 * that nobody has changed since it began. A session that settled something
 * says so by changing it; what it leaves as it found it, it has to vouch for,
 * or say it could not tell. What waits on a person's answer is not asked
 * about: no work in the repository settles it. Nor is what has a change
 * waiting for the human: what was found has been said, and is theirs to confirm.
 */
async function unreconciled(l: Lattice, run: Entity): Promise<Item[]> {
  const { rows: repos } = await l.db.query<{ to_id: string }>(`select to_id from relation where type = 'software.lives_in' and from_id = $1 and valid_to is null`, [run.id]);
  if (!repos.length) return [];
  const work = (await VIEWS.repo_work.run(l, { repo: repos[0].to_id })) as { ready: Item[]; blocked: Item[] };
  const graph = await blockGraph(l);
  const { rows: held } = await l.db.query<{ ops: Op[] }>(`select ops from proposal where status = 'pending'`);
  const proposed = new Set(held.flatMap((p) => p.ops.flatMap((o) => ('id' in o && o.id ? [o.id] : []))));
  const open = [...work.ready, ...work.blocked].filter((i) => !graph.waitsOnSomeone(i.id) && !proposed.has(i.id));
  const { rows: untouched } = await l.db.query<{ id: string }>(`select id from entity where id = any($1::text[]) and updated_at <= $2`, [open.map((i) => i.id), run.created_at]);
  return open.filter((i) => untouched.some((u) => u.id === i.id)).map(({ id, type, title, status }) => ({ id, type, title, status }));
}

export async function sessionEnd(
  l: Lattice,
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
  const unknown = input.cannot_tell_rest ? unsaid.filter((i) => !vouched.includes(i)) : named;
  // The rest are counted, not listed: a session that never looked at thirty items has nothing to say of each.
  const rest = unknown.length - named.length;
  const left = unsaid.filter((i) => !vouched.includes(i) && !unknown.includes(i));
  if (input.reconcile && left.length) {
    return {
      run: run.id,
      status: run.status,
      ended: false,
      unreconciled: left,
      note: 'Not ended yet. These are open in the repository this session worked in, and nobody has changed them since it began. For each: if it is done or no longer as written, change it with the change tool; if you checked it and it is still true as written, name its id in still_true; if this session had nothing to do with it and cannot check it from here, name its id in cannot_tell (or send cannot_tell_rest: true for all you have not otherwise named), and do not vouch for what you did not look at. Then call session_end again.',
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
  const { rows: working } = await l.db.query<{ id: string }>(`select id from relation where type = 'sys.works_on' and from_id = $1 and valid_to is null`, [run.id]);
  await l.apply(actorId(actor), {
    ops: [
      { op: 'update', id: run.id, status: outcome, body: summary ? [run.body, `[${now()}] ${outcome}: ${summary}`].filter(Boolean).join('\n') : undefined },
      ...working.map((w): Op => ({ op: 'unlink', relation: w.id })),
    ],
    reason: input.summary ?? `Session ${outcome}`,
  });
  await heard(l, run, `Session "${run.title}" ended`);
  // Whatever it held goes back, so a finished session can never keep the lane.
  const { rows: held } = await l.db.query<{ to_id: string }>(`select to_id from relation where type = 'holds' and from_id = $1 and valid_to is null`, [run.id]);
  for (const h of held) await l.release(actor, { resource: h.to_id, holder: run.id, reason: `Session ${outcome}` });
  return { run: run.id, status: outcome, released: held.length };
}

/**
 * A Claude Code SessionStart hook: register the session and return the text
 * to put in front of the model, so it starts knowing what the map knows.
 */
export async function hookSessionStart(l: Lattice, input: { session_id?: string; cwd?: string; remote?: string }): Promise<string> {
  const started = await sessionStart(l, { kind: 'agent', name: 'claude-code' }, { session_id: input.session_id, cwd: input.cwd, remote: typeof input.remote === 'string' ? input.remote : undefined, surface: 'claude-code' });
  const lines = [`This session is registered in Lattice, the owner's map of work and dependencies, as run ${started.run}.`];
  const repo = 'repo' in started ? started.repo : undefined;
  if (repo) {
    const work = (await VIEWS.repo_work.run(l, { repo: repo.id })) as {
      ready: { id: string; title: string; type: string; last_confirmed: string | Date }[];
      blocked: { id: string; title: string; waiting_on: (string | undefined)[] }[];
    };
    lines.push(`Repository: ${repo.title} (${repo.id}).`);
    // Where things stand is read off the map; the session is told how much has moved since someone last wrote it down.
    const stand = await handoff(l, { repo: repo.id });
    const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
    const then = stand.since_then;
    const from = stand.note ? `Its note, "${stand.note.title}" (${stand.note.id}), was written ${new Date(stand.note.written).toISOString().slice(0, 10)}; since then` : 'Nobody has written a handoff note here; in the last week';
    lines.push(`Where things stand: view "handoff" with repo ${repo.id}. ${from}: ${n(then.pushes.length, 'push', 'pushes')}, ${n(then.settled.length, 'item')} settled, ${n(then.opened.length, 'item')} opened, ${n(then.sessions.length, 'session')} ended.`);
    const kind = (t: { type: string }) => (l.registry.isA(t.type, 'issue') ? 'Issue: ' : '');
    // What nobody has touched for a while is said to be so: it may no longer be true.
    const age = (t: { last_confirmed: string | Date }) => {
      const days = Math.floor((Date.now() - new Date(t.last_confirmed).getTime()) / 86_400_000);
      return days >= UNCONFIRMED_DAYS ? `, not confirmed for ${days} days: check it before relying on it` : '';
    };
    if (work.ready.length) lines.push('', 'Open work and issues here that nothing blocks:', ...work.ready.slice(0, 15).map((t) => `- ${kind(t)}${t.title} (${t.id})${age(t)}`));
    if (work.blocked.length) lines.push('', 'Blocked work here:', ...work.blocked.slice(0, 15).map((t) => `- ${t.title} (${t.id}), waiting on: ${t.waiting_on.join('; ')}`));
  } else {
    lines.push(`Lattice does not know a repository for this folder${input.remote ? ` (a checkout of ${input.remote})` : ''}. If its work belongs in the map, give a repository there this address as its remote.`);
  }
  // The owner is here, in chat, and mostly nowhere else: what agents settled since they last answered is put to them now.
  const ask = await toConfirm(l, { limit: 15 });
  const judged = ask.questions.filter((q) => !q.on.startsWith('the owner'));
  if (ask.on_agents_judgment)
    lines.push(
      '',
      `For the owner, in your first reply: since they last looked, agents have settled ${ask.on_agents_judgment} ${ask.on_agents_judgment === 1 ? 'question' : 'questions'} on their own judgment${ask.on_owners_word ? ` (and recorded ${ask.on_owners_word} more as the owner's own answers in chat: say how many, and list them only if asked, with view "to_confirm")` : ''}. Show them these, a line for each, and ask them to confirm or correct. When they have answered, call confirmed with upto ${ask.upto} and what they said; change or reopen what they correct.`,
      ...judged.map((q) => `- ${q.title}: ${q.answer} (${q.id})`),
      ...(ask.on_agents_judgment > judged.length ? [`- and ${ask.on_agents_judgment - judged.length} more: view "to_confirm".`] : []),
    );
  const now = (await VIEWS.available_now.run(l, {})) as { held_resources: { title: string; held_by_title: string }[] };
  const { rows: exclusive } = await l.db.query<{ id: string; title: string }>(
    `select id, title from entity where type = 'resource' and is_open and archived_at is null and coalesce((props->>'exclusive')::boolean, true)`,
  );
  for (const res of exclusive) {
    const held = now.held_resources.find((h) => h.title === res.title);
    lines.push('', `Exclusive resource "${res.title}" (${res.id}) is ${held ? `HELD by ${held.held_by_title}: do not use it` : 'free'}. Claim it with the lattice claim tool (holder ${started.run}) before using it and release it after.`);
  }
  lines.push(
    '',
    'When you take on a task that has no estimate, give it one: how many tokens you expect it to take (props.tokens_estimated, with change). What is actually used is measured from this session and shown beside it.',
    'If the lattice MCP tools are available: when you take on one of these, call session_update with its id as task; call session_update with a note for anything the owner should know; propose changes to the map with change. Before you finish, call session_end with a summary: it shows you what is still open here that nobody has changed since you began, and asks you to change each, say it is still true, or say you cannot tell from here. A session that ends without it is closed for you and recorded as not reconciled.',
    'When Lattice itself gets in your way (a tool that fails or misleads, a workaround, an answer that is stale or too big, something the owner finds bad in its screens), record it on the map as an issue when it happens, after searching for it: say what you were doing, what happened, and what would have made it smooth. That is how it gets fixed.',
    'Keep the map true: when what you do or find settles something still open here (a task done, an experiment run, a decision made in practice), change its status with the outcome and the evidence rather than leaving a note. Closing a decision or hypothesis waits for the owner to confirm unless this workspace applies agents’ changes as made, so send the answer with what was chosen and why.',
  );
  return lines.join('\n');
}

export async function hookSessionEnd(l: Lattice, input: { session_id?: string; reason?: string }): Promise<void> {
  if (!input.session_id) return;
  const run = await resolveRun(l, input.session_id, true);
  if (run) await sessionEnd(l, { kind: 'agent', name: 'claude-code' }, { run: run.id, outcome: 'finished', summary: input.reason ? `Session ended (${input.reason})` : undefined });
}
