// Sessions: an agent session (or automation run) registers itself in the map
// as a sys.run, says what it is working on, and takes the exclusive resources
// that work needs. These writes skip the proposal step, like claim and
// release: they are the session's own operational state, not facts about the
// world, and coordination that waits for approval is no coordination.

import { actorId, type Actor, type Entity, type Lattice, type Op } from './lattice.ts';
import { VIEWS } from './views.ts';

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

export async function sessionEnd(l: Lattice, actor: Actor, input: { run: string; outcome?: 'finished' | 'failed' | 'cancelled'; summary?: string }) {
  const run = await resolveRun(l, input.run);
  if (!run) throw new Error(`No session "${input.run}"`);
  if (!run.is_open) return { run: run.id, status: run.status, already_ended: true };
  const outcome = input.outcome ?? 'finished';
  const { rows: working } = await l.db.query<{ id: string }>(`select id from relation where type = 'sys.works_on' and from_id = $1 and valid_to is null`, [run.id]);
  await l.apply(actorId(actor), {
    ops: [
      { op: 'update', id: run.id, status: outcome, body: input.summary ? [run.body, `[${now()}] ${outcome}: ${input.summary}`].filter(Boolean).join('\n') : undefined },
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
      ready: { id: string; title: string; type: string }[];
      blocked: { id: string; title: string; waiting_on: (string | undefined)[] }[];
    };
    lines.push(`Repository: ${repo.title}.`);
    if (work.ready.length) lines.push('', 'Open work here that nothing blocks:', ...work.ready.slice(0, 15).map((t) => `- ${t.title} (${t.id})`));
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
    'If the lattice MCP tools are available: when you take on one of these, call session_update with its id as task; call session_update with a note for anything the owner should know; propose changes to the map with change. The session is closed for you when it ends.',
  );
  return lines.join('\n');
}

export async function hookSessionEnd(l: Lattice, input: { session_id?: string; reason?: string }): Promise<void> {
  if (!input.session_id) return;
  const run = await resolveRun(l, input.session_id, true);
  if (run) await sessionEnd(l, { kind: 'agent', name: 'claude-code' }, { run: run.id, outcome: 'finished', summary: input.reason ? `Session ended (${input.reason})` : undefined });
}
