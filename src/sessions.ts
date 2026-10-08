// Sessions: an agent session (or automation run) registers itself in the map
// as a sys.run, says what it is working on, and takes the exclusive resources
// that work needs. These writes skip the proposal step, like claim and
// release: they are the session's own operational state, not facts about the
// world, and coordination that waits for approval is no coordination.

import { actorId, type Actor, type Entity, type Lattice, type Op } from './lattice.ts';
import { UNCONFIRMED_DAYS, VIEWS } from './views.ts';

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

/** The repository whose checkout contains this directory, if the map knows one. */
async function repoFor(l: Lattice, cwd: string): Promise<Entity | undefined> {
  if (!l.registry.type('software.repo')) return undefined;
  const { rows } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null and props ? 'path'`, [
    l.registry.family('software.repo'),
  ]);
  const here = norm(cwd);
  return rows
    .filter((r) => here === norm(r.props.path as string) || here.startsWith(norm(r.props.path as string) + '/'))
    .sort((a, b) => (b.props.path as string).length - (a.props.path as string).length)[0];
}

export async function sessionStart(
  l: Lattice,
  actor: Actor,
  input: { title?: string; surface?: string; cwd?: string; session_id?: string; task?: string },
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
  const repo = input.cwd ? await repoFor(l, input.cwd) : undefined;

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

export async function sessionUpdate(l: Lattice, actor: Actor, input: { run: string; status?: 'running' | 'waiting'; note?: string; task?: string }) {
  const run = await resolveRun(l, input.run);
  if (!run) throw new Error(`No session "${input.run}"`);
  if (!run.is_open) throw new Error(`Session "${run.title}" has already ended`);
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
  return { run: run.id, status: input.status ?? run.status };
}

type Item = { id: string; type: string; title: string; status: string };

/**
 * What a session has left unsaid: the open work of the repository it ran in
 * that nobody has changed since it began. A session that settled something
 * says so by changing it; what it leaves as it found it, it has to vouch for.
 */
async function unreconciled(l: Lattice, run: Entity): Promise<Item[]> {
  const { rows: repos } = await l.db.query<{ to_id: string }>(`select to_id from relation where type = 'software.lives_in' and from_id = $1 and valid_to is null`, [run.id]);
  if (!repos.length) return [];
  const work = (await VIEWS.repo_work.run(l, { repo: repos[0].to_id })) as { ready: Item[]; blocked: Item[] };
  const open = [...work.ready, ...work.blocked];
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
  const left = unsaid.filter((i) => !vouched.includes(i));
  if (input.reconcile && left.length) {
    return {
      run: run.id,
      status: run.status,
      ended: false,
      unreconciled: left,
      note: 'Not ended yet. These are open in the repository this session worked in, and nobody has changed them since it began. For each: if it is done or no longer as written, change it with the change tool; if it is still true as written, name its id in still_true. Then call session_end again.',
    };
  }
  const said = [
    vouched.length && `Said still true: ${vouched.map((i) => `${i.title} (${i.id})`).join('; ')}.`,
    left.length && `Not reconciled, open and left unsaid: ${left.map((i) => `${i.title} (${i.id})`).join('; ')}.`,
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
  // Whatever it held goes back, so a finished session can never keep the lane.
  const { rows: held } = await l.db.query<{ to_id: string }>(`select to_id from relation where type = 'holds' and from_id = $1 and valid_to is null`, [run.id]);
  for (const h of held) await l.release(actor, { resource: h.to_id, holder: run.id, reason: `Session ${outcome}` });
  return { run: run.id, status: outcome, released: held.length };
}

/**
 * A Claude Code SessionStart hook: register the session and return the text
 * to put in front of the model, so it starts knowing what the map knows.
 */
export async function hookSessionStart(l: Lattice, input: { session_id?: string; cwd?: string }): Promise<string> {
  const started = await sessionStart(l, { kind: 'agent', name: 'claude-code' }, { session_id: input.session_id, cwd: input.cwd, surface: 'claude-code' });
  const lines = [`This session is registered in Lattice, the owner's map of work and dependencies, as run ${started.run}.`];
  const repo = 'repo' in started ? started.repo : undefined;
  if (repo) {
    const work = (await VIEWS.repo_work.run(l, { repo: repo.id })) as {
      ready: { id: string; title: string; type: string; last_confirmed: string | Date }[];
      blocked: { id: string; title: string; waiting_on: (string | undefined)[] }[];
    };
    lines.push(`Repository: ${repo.title} (${repo.id}).`);
    const kind = (t: { type: string }) => (l.registry.isA(t.type, 'issue') ? 'Issue: ' : '');
    // What nobody has touched for a while is said to be so: it may no longer be true.
    const age = (t: { last_confirmed: string | Date }) => {
      const days = Math.floor((Date.now() - new Date(t.last_confirmed).getTime()) / 86_400_000);
      return days >= UNCONFIRMED_DAYS ? `, not confirmed for ${days} days: check it before relying on it` : '';
    };
    if (work.ready.length) lines.push('', 'Open work and issues here that nothing blocks:', ...work.ready.slice(0, 15).map((t) => `- ${kind(t)}${t.title} (${t.id})${age(t)}`));
    if (work.blocked.length) lines.push('', 'Blocked work here:', ...work.blocked.slice(0, 15).map((t) => `- ${t.title} (${t.id}), waiting on: ${t.waiting_on.join('; ')}`));
  } else {
    lines.push('Lattice does not know a repository for this folder.');
  }
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
    'If the lattice MCP tools are available: when you take on one of these, call session_update with its id as task; call session_update with a note for anything the owner should know; propose changes to the map with change. Before you finish, call session_end with a summary: it shows you what is still open here that nobody has changed since you began, and asks you to change each or say it is still true. A session that ends without it is closed for you and recorded as not reconciled.',
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
