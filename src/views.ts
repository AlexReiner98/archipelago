// Views: the questions the map exists to answer. Nothing here is stored;
// blockers are derived from relations every time, so they cannot go stale.

import { lastPushes, repoByName, repoName } from './github.ts';
import { ACTIVE_HOLDS, type Entity, type Lattice } from './lattice.ts';

interface Edge {
  x: string;
  y: string;
  why: 'depends_on' | 'resource_unavailable' | 'resource_held';
}

interface Brief {
  id: string;
  type: string;
  title: string;
  status: string;
  owner: string | null;
  due: string | null;
}

// x is blocked by y when: x depends on something still open; x needs a
// resource that is unavailable; or x needs an exclusive resource someone else
// holds (unless it is held for x).
const EDGES = `
  select r.from_id as x, r.to_id as y, 'depends_on' as why
    from relation r join entity x on x.id = r.from_id join entity y on y.id = r.to_id
   where r.type = 'depends_on' and r.valid_to is null
     and x.is_open and x.archived_at is null and y.is_open and y.archived_at is null
  union all
  select r.from_id, r.to_id, 'resource_unavailable'
    from relation r join entity x on x.id = r.from_id join entity y on y.id = r.to_id
   where r.type = 'needs' and r.valid_to is null
     and x.is_open and x.archived_at is null and y.status = 'unavailable' and y.archived_at is null
  union all
  select n.from_id, n.to_id, 'resource_held'
    from relation n join entity x on x.id = n.from_id join entity res on res.id = n.to_id
    join ${ACTIVE_HOLDS} h on h.to_id = n.to_id
   where n.type = 'needs' and n.valid_to is null
     and x.is_open and x.archived_at is null and res.archived_at is null
     and coalesce((res.props->>'exclusive')::boolean, true)
     and h.from_id <> n.from_id and coalesce(h.props->>'for', '') <> n.from_id
`;

class BlockGraph {
  readonly direct = new Map<string, Edge[]>();

  constructor(edges: Edge[]) {
    for (const edge of edges) this.direct.set(edge.x, [...(this.direct.get(edge.x) ?? []), edge]);
  }

  isBlocked(id: string): boolean {
    return this.direct.has(id);
  }

  /** The things at the end of every chain from id: what actually has to move first. */
  roots(id: string): string[] {
    const roots = new Set<string>();
    const seen = new Set<string>([id]);
    const stack = [id];
    while (stack.length) {
      const edges = this.direct.get(stack.pop()!) ?? [];
      for (const { y } of edges) {
        if (seen.has(y)) continue;
        seen.add(y);
        if (this.direct.has(y)) stack.push(y);
        else roots.add(y);
      }
    }
    return [...roots];
  }
}

export async function blockGraph(l: Lattice): Promise<BlockGraph> {
  const { rows } = await l.db.query<Edge>(EDGES);
  return new BlockGraph(rows);
}

async function briefs(l: Lattice, ids: Iterable<string>): Promise<Map<string, Brief>> {
  const list = [...new Set(ids)];
  if (!list.length) return new Map();
  const { rows } = await l.db.query<Brief>(
    `select id, type, title, status, owner, props->>'due' as due from entity where id = any($1::text[])`,
    [list],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

async function person(l: Lattice, given?: string): Promise<string> {
  const id = given ?? (l.viewer || (await l.setting<string>('me')));
  if (!id) throw new Error('No person given and no workspace owner set. Run: lattice init "Your Name"');
  return id;
}

async function blockers(l: Lattice, input: { owner?: string }) {
  const graph = await blockGraph(l);
  const ids = [...graph.direct.keys()];
  const rootsOf = new Map(ids.map((id) => [id, graph.roots(id)]));
  const all = await briefs(l, [...ids, ...[...graph.direct.values()].flat().map((e) => e.y), ...[...rootsOf.values()].flat()]);
  return ids
    .filter((id) => !input.owner || all.get(id)?.owner === input.owner)
    .map((id) => ({
      entity: all.get(id),
      blocked_by: graph.direct.get(id)!.map((e) => ({ why: e.why, entity: all.get(e.y) })),
      root_blockers: rootsOf.get(id)!.map((r) => all.get(r)),
    }));
}

async function availableNow(l: Lattice, input: { owner?: string }) {
  const graph = await blockGraph(l);
  const { rows: tasks } = await l.db.query<Brief>(
    `select id, type, title, status, owner, props->>'due' as due from entity
     where type = any($1::text[]) and is_open and archived_at is null and ($2::text is null or owner = $2)
     order by props->>'due' nulls last, updated_at desc`,
    [l.registry.family('task'), input.owner ?? null],
  );
  const { rows: held } = await l.db.query(
    `select res.id as resource, res.title, h.from_id as held_by, h.holder_title as held_by_title, h.props->>'for' as held_for, h.valid_from as since
     from ${ACTIVE_HOLDS} h join entity res on res.id = h.to_id`,
  );
  const resourceOnly = (id: string) => graph.direct.get(id)!.every((e) => e.why !== 'depends_on');
  const names = await briefs(l, [...graph.direct.values()].flat().map((e) => e.y));
  return {
    ready: tasks.filter((t) => !graph.isBlocked(t.id)),
    waiting_on_resource: tasks
      .filter((t) => graph.isBlocked(t.id) && resourceOnly(t.id))
      .map((t) => ({ ...t, waiting_on: graph.direct.get(t.id)!.map((e) => ({ why: e.why, resource: names.get(e.y)?.title, id: e.y })) })),
    held_resources: held,
  };
}

async function needsMe(l: Lattice, input: { person?: string }) {
  const me = await person(l, input.person);
  const graph = await blockGraph(l);
  const { rows } = await l.db.query<Brief>(
    `select id, type, title, status, owner, props->>'due' as due from entity
     where owner = $1 and type = any($2::text[]) and is_open and archived_at is null
     order by props->>'due' nulls last, updated_at desc`,
    [me, [...l.registry.family('task'), ...l.registry.family('decision')]],
  );
  const pending = await l.db.query<{ n: number }>(`select count(*)::int as n from proposal where status = 'pending'`);
  return {
    actionable: rows.filter((r) => !graph.isBlocked(r.id)),
    proposals_awaiting_review: pending.rows[0].n,
  };
}

async function blockedOnMe(l: Lattice, input: { person?: string }) {
  const me = await person(l, input.person);
  const graph = await blockGraph(l);
  const waiting = new Map<string, string[]>(); // my blocker -> what it holds up
  for (const id of graph.direct.keys()) {
    for (const root of graph.roots(id)) waiting.set(root, [...(waiting.get(root) ?? []), id]);
  }
  const all = await briefs(l, [...waiting.keys(), ...[...waiting.values()].flat()]);
  return [...waiting.entries()]
    .filter(([root]) => all.get(root)?.owner === me)
    .map(([root, held]) => ({ entity: all.get(root), holding_up: held.map((id) => all.get(id)) }))
    .sort((a, b) => b.holding_up.length - a.holding_up.length);
}

async function waitingOn(l: Lattice, input: { person?: string }) {
  const me = await person(l, input.person);
  const graph = await blockGraph(l);
  const ids = [...graph.direct.keys()];
  const rootsOf = new Map(ids.map((id) => [id, graph.roots(id)]));
  const all = await briefs(l, [...ids, ...[...rootsOf.values()].flat()]);
  const blocked = ids
    .filter((id) => all.get(id)?.owner === me)
    .map((id) => ({ entity: all.get(id), waiting_on: rootsOf.get(id)!.map((r) => all.get(r)).filter((r) => r?.owner !== me) }))
    .filter((row) => row.waiting_on.length);
  const { rows: owed } = await l.db.query<Brief>(
    `select t.id, t.type, t.title, t.status, t.owner, t.props->>'due' as due
     from relation r join entity t on t.id = r.from_id
     where r.type = 'owed_to' and r.to_id = $1 and r.valid_to is null and t.is_open and t.archived_at is null
       and t.owner is distinct from $1
     order by t.props->>'due' nulls last`,
    [me],
  );
  return { blocked_by_others: blocked, owed_to_me: owed };
}

async function changedSince(l: Lattice, input: { since?: string; limit?: number }) {
  if (!input.since || Number.isNaN(Date.parse(input.since))) throw new Error('changed_since needs "since" as an ISO date or date-time');
  const events = (await l.events({ since: input.since, limit: input.limit ?? 200 })) as { action: string }[];
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.action] = (counts[e.action] ?? 0) + 1;
  return { since: input.since, counts, events };
}

async function atRisk(l: Lattice, input: { days?: number }) {
  const days = input.days ?? 7;
  const graph = await blockGraph(l);
  const { rows: due } = await l.db.query<Brief & { overdue: boolean }>(
    `select id, type, title, status, owner, props->>'due' as due, (props->>'due')::date < current_date as overdue
     from entity where is_open and archived_at is null and props ? 'due'
       and (props->>'due')::date <= current_date + $1::int
     order by props->>'due'`,
    [days],
  );
  const { rows: assumptions } = await l.db.query(
    `select x.id, x.type, x.title, x.status, x.owner, h.id as hypothesis, h.title as hypothesis_title
     from relation r join entity x on x.id = r.from_id join entity h on h.id = r.to_id
     where r.type = 'assumes' and r.valid_to is null and h.status = 'refuted'
       and x.is_open and x.archived_at is null`,
  );
  return {
    due_within_days: days,
    due_soon_or_overdue: due.map((d) => ({ ...d, blocked: graph.isBlocked(d.id) })),
    resting_on_refuted_hypothesis: assumptions,
  };
}

/** Minutes without a report before an open session is shown as stale. */
const STALE_MINUTES = 30;

async function sessions(l: Lattice) {
  const runs = l.registry.family('sys.run');
  const { rows: open } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and is_open and archived_at is null order by created_at desc`, [runs]);
  const { rows: links } = await l.db.query<{ run: string; type: string; id: string; title: string; entity_type: string }>(
    `select r.from_id as run, r.type, e.id, e.title, e.type as entity_type from relation r join entity e on e.id = r.to_id
     where r.from_id = any($1::text[]) and r.valid_to is null and r.type in ('sys.works_on', 'holds', 'software.lives_in')`,
    [open.map((r) => r.id)],
  );
  const { rows: ended } = await l.db.query(
    `select id, title, status, updated_at from entity where type = any($1::text[]) and not is_open and archived_at is null order by updated_at desc limit 10`,
    [runs],
  );
  const of = (run: string, type: string) => links.filter((x) => x.run === run && x.type === type).map(({ id, title, entity_type }) => ({ id, title, type: entity_type }));
  return {
    stale_after_minutes: STALE_MINUTES,
    open: open.map((r) => {
      const seen = (r.props.last_seen as string | undefined) ?? r.created_at.toISOString();
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        surface: r.props.surface,
        cwd: r.props.cwd,
        started: r.created_at,
        last_seen: seen,
        stale: Date.now() - Date.parse(seen) > STALE_MINUTES * 60_000,
        working_on: of(r.id, 'sys.works_on'),
        holds: of(r.id, 'holds'),
        repo: of(r.id, 'software.lives_in')[0],
      };
    }),
    recently_ended: ended,
  };
}

/** Everything a session needs to start on a task, as data and as text to paste. */
async function brief(l: Lattice, input: { task?: string }) {
  if (!input.task) throw new Error('brief needs "task": the id of the entity to work on');
  const task = await l.entity(input.task);
  if (!task) throw new Error(`No entity "${input.task}"`);

  // The task, then what it is part of, outwards.
  const chain: Entity[] = [task];
  for (let at = task.id, depth = 0; depth < 6; depth++) {
    const { rows } = await l.db.query<Entity>(
      `select e.* from relation r join entity e on e.id = r.to_id where r.type = 'part_of' and r.from_id = $1 and r.valid_to is null limit 1`,
      [at],
    );
    if (!rows[0] || chain.some((c) => c.id === rows[0].id)) break;
    chain.push(rows[0]);
    at = rows[0].id;
  }
  const ids = chain.map((c) => c.id);
  const related = async (type: string, from: string[]) =>
    (
      await l.db.query<Entity>(
        `select distinct e.* from relation r join entity e on e.id = r.to_id where r.type = $1 and r.from_id = any($2::text[]) and r.valid_to is null and e.archived_at is null`,
        [type, from],
      )
    ).rows;

  const [repo] = l.registry.relations.has('software.lives_in') ? await related('software.lives_in', ids) : [];
  const needs = await related('needs', [task.id]);
  const rules = await related('governed_by', [...ids, ...needs.map((n) => n.id)]);
  const issues = await related('addresses', [task.id]);
  const assumptions = await related('assumes', ids);
  const graph = await blockGraph(l);
  const roots = graph.roots(task.id);
  const names = await briefs(l, [...(graph.direct.get(task.id) ?? []).map((e) => e.y), ...roots]);
  const blockedBy = (graph.direct.get(task.id) ?? []).map((e) => ({ why: e.why, entity: names.get(e.y) }));
  const { rows: held } = await l.db.query<{ to_id: string; title: string }>(
    `select h.to_id, h.holder_title as title from ${ACTIVE_HOLDS} h where h.to_id = any($1::text[])`,
    [needs.map((n) => n.id)],
  );

  const lines = [`# ${task.title}`, `${l.registry.type(task.type)?.title ?? task.type}, ${task.status}. Lattice id: ${task.id}`];
  if (task.body) lines.push('', task.body);
  if (chain.length > 1) lines.push('', `Part of: ${chain.slice(1).map((c) => c.title).join(' > ')}`);
  if (repo) lines.push(`Repository: ${repo.title} (${repo.props.path ?? repo.props.remote ?? 'no path recorded'})`);
  if (roots.length) {
    lines.push('', '## Blocked', 'This cannot finish until:');
    for (const id of roots) lines.push(`- ${names.get(id)?.title} (${names.get(id)?.type}, ${names.get(id)?.status})`);
  }
  if (needs.length) {
    lines.push('', '## Needs');
    for (const n of needs) {
      const holder = held.find((h) => h.to_id === n.id);
      lines.push(`- ${n.title}: ${n.status}${holder ? `, held by ${holder.title}` : ''}${n.props.exclusive === false ? '' : ' (exclusive: claim it before use, release it after)'}`);
    }
  }
  if (rules.length) {
    lines.push('', '## Rules that apply');
    for (const r of rules) lines.push(`- ${r.title}${r.props.outcome ? ` ${r.props.outcome}` : ''}${r.props.rationale ? ` Why: ${r.props.rationale}` : ''}${!r.props.outcome && r.body ? ` ${r.body}` : ''}`);
  }
  if (issues.length) lines.push('', '## Addresses', ...issues.map((i) => `- ${i.title} (${i.status})${i.body ? `: ${i.body}` : ''}`));
  if (assumptions.length) lines.push('', '## Assumes', ...assumptions.map((a) => `- ${a.title} (${a.status})`));
  lines.push('', '## Reporting', `Register with lattice (session_start, task ${task.id}), note anything worth knowing with session_update, and call session_end with a summary when done.`);

  const slim = (e: Entity) => ({ id: e.id, type: e.type, title: e.title, status: e.status });
  return {
    task: slim(task),
    part_of: chain.slice(1).map(slim),
    repo: repo && { ...slim(repo), path: repo.props.path },
    blocked_by: blockedBy,
    root_blockers: roots.map((id) => names.get(id)),
    needs: needs.map((n) => ({ ...slim(n), exclusive: n.props.exclusive !== false, held_by: held.find((h) => h.to_id === n.id)?.title })),
    rules: rules.map(slim),
    text: lines.join('\n'),
  };
}

/**
 * A repository by its id, by its GitHub name (an agent run from the repository
 * itself knows only that), or by its title in the map (what a session is told).
 * Asked for none, or one that is not there, it says which there are.
 */
async function findRepo(l: Lattice, key: string | undefined, view: string): Promise<Entity> {
  const { rows: repos } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null order by title`, [l.registry.family('software.repo')]);
  const wanted = key?.trim().toLowerCase();
  const repo = wanted && (repos.find((r) => r.id === wanted) ?? (await repoByName(l, repoName(key))) ?? repos.find((r) => r.title.toLowerCase() === wanted));
  if (repo) return repo;
  const known = repos.map((r) => `${r.title} (${r.id})`).join(', ') || 'none';
  throw new Error(`${key ? `No repository "${key}" in the map` : `${view} needs "repo"`}: give its id, its GitHub name ("owner/name") or its title. Repositories here: ${known}`);
}

/**
 * Everything that lives in a repository, and all that is part of that or about
 * it, as a query over $1. An issue is often filed as about a project, not as
 * part of it, and is the repository's work all the same.
 */
const REPO_SCOPE = `with recursive scope(id) as (
       select from_id from relation where type = 'software.lives_in' and to_id = $1 and valid_to is null
       union
       select r.from_id from relation r join scope s on r.to_id = s.id where r.type in ('part_of', 'about') and r.valid_to is null
     )`;

/** An item and all that is part of it or about it, as a query over $1; everything, when $1 is null. */
const UNDER = `with recursive scope(id) as (
       select $1::text
       union
       select r.from_id from relation r join scope s on r.to_id = s.id where r.type in ('part_of', 'about') and r.valid_to is null
     )`;

/** Open work that belongs to whatever lives in a repository, split by whether it can run now. */
async function repoWork(l: Lattice, input: { repo?: string }) {
  const repo = await findRepo(l, input.repo, 'repo_work');
  input = { repo: repo.id };
  const graph = await blockGraph(l);
  const { rows } = await l.db.query<Brief & { last_confirmed: Date }>(
    `${REPO_SCOPE}
     select e.id, e.type, e.title, e.status, e.owner, e.props->>'due' as due, e.updated_at as last_confirmed
     from entity e join scope s on s.id = e.id
     where e.is_open and e.archived_at is null and e.type = any($2::text[])
     order by e.props->>'due' nulls last, e.updated_at desc`,
    [input.repo, [...l.registry.family('task'), ...l.registry.family('decision'), ...l.registry.family('issue')]],
  );
  const names = await briefs(l, rows.flatMap((r) => graph.roots(r.id)));
  return {
    repo: { id: repo.id, title: repo.title },
    last_push: (await lastPushes(l)).get(repo.id) ?? null,
    ready: rows.filter((r) => !graph.isBlocked(r.id)),
    blocked: rows.filter((r) => graph.isBlocked(r.id)).map((r) => ({ ...r, waiting_on: graph.roots(r.id).map((id) => names.get(id)?.title) })),
  };
}

/** Days without a change, or a word that it is still true, before open work is said to be unconfirmed. */
export const UNCONFIRMED_DAYS = 14;

/** The kinds of thing that are true or not of the world, and so go stale: work, questions and problems. */
const GOES_STALE = ['task', 'decision', 'issue', 'hypothesis', 'experiment', 'software.feature'];

/**
 * Open work nobody has changed, or said is still true, for longest. An item's
 * last change is when it was last known true: an update that changes nothing
 * is how someone who checked it says so.
 */
async function oldest(l: Lattice, input: { days?: number; repo?: string; project?: string; limit?: number }) {
  const days = input.days ?? UNCONFIRMED_DAYS;
  const repo = input.repo ? await findRepo(l, input.repo, 'oldest') : undefined;
  const { rows } = await l.db.query<Brief & { last_confirmed: Date; days: number }>(
    `${repo ? REPO_SCOPE : UNDER}
     select e.id, e.type, e.title, e.status, e.owner, e.updated_at as last_confirmed,
            floor(extract(epoch from now() - e.updated_at) / 86400)::int as days
     from entity e
     where e.is_open and e.archived_at is null and e.type = any($2::text[])
       and e.updated_at <= now() - make_interval(days => $3::int)
       and ($1::text is null or e.id in (select id from scope))
     order by e.updated_at limit $4`,
    [repo?.id ?? input.project ?? null, GOES_STALE.flatMap((t) => l.registry.family(t)), days, input.limit ?? 20],
  );
  return {
    older_than_days: days,
    repo: repo && { id: repo.id, title: repo.title },
    items: rows,
    note: 'Check each against what is so. If it is done or no longer as written, change it. If it is still true as written, send an update for it that changes nothing: that records that you checked, and when.',
  };
}

/** How often a project's oldest items are re-checked when the project does not say: weekly. */
const RECHECK_DAYS = 7;

/** A project's own answer to how often, and whether it has waited that long since the last time. */
function recheckOf(project: Entity, now = Date.now()) {
  const every = typeof project.props.recheck_days === 'number' ? project.props.recheck_days : RECHECK_DAYS;
  const last = project.props.rechecked_at as string | undefined;
  // Two hours of grace, so a daily asker that comes a little early one day does not wait another.
  const waited = every > 0 && (!last || now - Date.parse(last) >= every * 86_400_000 - 7_200_000);
  return { every, last: last ?? null, waited };
}

/** The open projects that live in a repository. */
export async function projectsIn(l: Lattice, repo: string): Promise<Entity[]> {
  const { rows } = await l.db.query<Entity>(
    `select p.* from relation r join entity p on p.id = r.from_id
     where r.type = 'software.lives_in' and r.to_id = $1 and r.valid_to is null and p.type = any($2::text[]) and p.is_open and p.archived_at is null
     order by p.created_at`,
    [repo, l.registry.family('project')],
  );
  return rows;
}

/**
 * What a scheduled agent should re-check in a repository now: for each
 * project there that has waited as long as it asks between re-checks, its
 * open items nobody has changed or confirmed in that time, oldest first. The
 * list is long on purpose: the oldest are often chores no repository can
 * settle, and the one re-checking has to be able to get past them.
 */
async function recheck(l: Lattice, input: { repo?: string; limit?: number; now?: boolean }) {
  const repo = await findRepo(l, input.repo, 'recheck');
  const projects = [];
  for (const p of await projectsIn(l, repo.id)) {
    const { every, last, waited } = recheckOf(p);
    // Asked for now, the interval and the items' age are set aside: whatever is oldest is looked at.
    const items = input.now || waited ? (await oldest(l, { project: p.id, days: input.now ? 0 : every, limit: input.limit ?? 25 })).items : [];
    projects.push({ id: p.id, title: p.title, every_days: every, rechecked_at: last, due: items.length > 0, items });
  }
  return {
    repo: { id: repo.id, title: repo.title },
    due: projects.some((p) => p.due),
    projects,
    note: 'For each item of a project that is due: check it against the repository. If it is done or no longer as written, change it. If it is still true as written, send an update for it that changes nothing. When you are done, call rechecked for the repository.',
  };
}

/** Projects in a repository that have waited out their interval, whether or not anything in them is old. */
export async function awaitingRecheck(l: Lattice, repoKey: string): Promise<Entity[]> {
  const repo = await findRepo(l, repoKey, 'rechecked');
  return (await projectsIn(l, repo.id)).filter((p) => recheckOf(p).waited);
}

/**
 * What agents have used in a repository: every run there that counted its
 * tokens (a session on someone's machine, the sync agent in GitHub Actions),
 * newest first, and the sum for each place they ran over the last week and
 * the last thirty days.
 */
async function agentUsage(l: Lattice, input: { repo?: string; limit?: number }) {
  const repo = await findRepo(l, input.repo, 'agent_usage');
  const { rows } = await l.db.query<Entity>(
    `select e.* from entity e join relation r on r.from_id = e.id and r.type = 'software.lives_in' and r.valid_to is null
     where r.to_id = $1 and e.type = any($2::text[]) and e.archived_at is null and (e.props->>'tokens_used') is not null
     order by e.created_at desc limit 500`,
    [repo.id, l.registry.family('sys.run')],
  );
  const runs = rows.map((e) => ({
    id: e.id,
    title: e.title,
    status: e.status,
    surface: (e.props.surface as string | undefined) ?? 'unknown',
    tokens: Number(e.props.tokens_used ?? 0),
    cost_usd: e.props.cost_usd as number | undefined,
    turns: e.props.turns as number | undefined,
    link: e.props.link as string | undefined,
    at: e.created_at,
  }));
  const within = (days: number) => {
    const since = Date.now() - days * 86_400_000;
    const by: Record<string, { runs: number; tokens: number; cost_usd: number }> = {};
    for (const run of runs.filter((x) => new Date(x.at).getTime() >= since)) {
      const sum = (by[run.surface] ??= { runs: 0, tokens: 0, cost_usd: 0 });
      sum.runs++;
      sum.tokens += run.tokens;
      sum.cost_usd = Math.round((sum.cost_usd + (run.cost_usd ?? 0)) * 10_000) / 10_000;
    }
    return by;
  };
  return { repo: { id: repo.id, title: repo.title }, week: within(7), month: within(30), runs: runs.slice(0, input.limit ?? 20) };
}

/** Which relations each preset draws. */
const GRAPH_PRESETS: Record<string, string[] | undefined> = {
  blocking: ['depends_on', 'needs', 'holds'],
  structure: ['part_of', 'serves', 'software.lives_in', 'works_at'],
  all: undefined,
};
const GRAPH_LIMIT = 400;

/** Nodes and edges for drawing: the whole map under a preset, or the neighbourhood of one entity. */
async function graph(l: Lattice, input: { focus?: string; depth?: number; relations?: string; include_closed?: boolean; include_system?: boolean }) {
  const preset = input.relations ?? (input.focus ? 'all' : 'blocking');
  if (!(preset in GRAPH_PRESETS)) throw new Error(`relations must be one of: ${Object.keys(GRAPH_PRESETS).join(', ')}`);
  const only = GRAPH_PRESETS[preset];
  const { rows: entities } = await l.db.query<Entity>(`select id, type, title, status, is_open, props from entity where archived_at is null`);
  const system = (type: string) => type.startsWith('sys.') && !l.registry.isA(type, 'resource');
  const eligible = new Map(
    entities.filter((e) => e.id === input.focus || ((input.include_closed || e.is_open) && (input.include_system || !system(e.type)))).map((e) => [e.id, e]),
  );
  if (input.focus && !eligible.has(input.focus)) throw new Error(`No entity "${input.focus}"`);
  const { rows: relations } = await l.db.query<{ id: string; type: string; from_id: string; to_id: string }>(
    `select id, type, from_id, to_id from relation where valid_to is null and ($1::text[] is null or type = any($1::text[]))`,
    [only ?? null],
  );
  let edges = relations.filter((r) => eligible.has(r.from_id) && eligible.has(r.to_id));

  let keep: Set<string>;
  if (input.focus) {
    // Walk outwards from the focus, ignoring direction.
    const depth = Math.min(Math.max(input.depth ?? 2, 1), 4);
    keep = new Set([input.focus]);
    let frontier = [input.focus];
    for (let d = 0; d < depth && frontier.length; d++) {
      const next: string[] = [];
      for (const e of edges) {
        for (const [a, b] of [[e.from_id, e.to_id], [e.to_id, e.from_id]]) {
          if (frontier.includes(a) && !keep.has(b)) {
            keep.add(b);
            next.push(b);
          }
        }
      }
      frontier = next;
    }
  } else {
    // Without a focus, an entity nothing connects to adds nothing to a graph.
    keep = new Set(edges.flatMap((e) => [e.from_id, e.to_id]));
  }
  const total = keep.size;
  if (keep.size > GRAPH_LIMIT) keep = new Set([...keep].slice(0, GRAPH_LIMIT));
  edges = edges.filter((e) => keep.has(e.from_id) && keep.has(e.to_id));

  // Tokens: what each thing is expected to take and has taken, with everything that is part of it, in sight or not.
  // A thing with parts is expected to take the sum of what they are; its own estimate stands only while none of its
  // parts has one. Where some parts have an estimate and some have not, the sum is short, and says so (`partial`).
  const all = new Map(entities.map((e) => [e.id, e]));
  const { rows: parts } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'part_of' and valid_to is null`);
  const partsOf = new Map<string, string[]>();
  for (const p of parts) if (all.has(p.from_id)) partsOf.set(p.to_id, [...(partsOf.get(p.to_id) ?? []), p.from_id]);
  // What is work, and so has a place on a scale of tokens: what can be estimated, and what such things are part of.
  const work = (type: string) => Boolean(l.registry.type(type)?.fields.tokens_estimated) || l.registry.isA(type, 'project');
  type Tokens = { estimated: number; used: number; assumed?: boolean; partial?: boolean };
  const totals = new Map<string, Tokens>();
  // A feature that is built is done, though it stays open until it ships.
  const done = (e: Entity | undefined) => Boolean(e) && (!e!.is_open || e!.status === 'built');
  const tokens = (id: string, trail = new Set<string>()): Tokens => {
    const known = totals.get(id);
    if (known) return known;
    if (trail.has(id)) return { estimated: 0, used: 0 }; // a loop of belonging: stop going round
    trail.add(id);
    // Only work has tokens. And a part that is also part of another part (a task of a feature, linked to the project too) is counted there, once.
    const mine = (partsOf.get(id) ?? []).filter((part) => work(all.get(part)!.type));
    const nearer = new Set(mine.flatMap((part) => partsOf.get(part) ?? []));
    const inside = mine.filter((part) => !nearer.has(part)).map((part) => tokens(part, trail));
    trail.delete(id);
    const own = all.get(id)?.props ?? {};
    const ofParts = inside.reduce((n, t) => n + t.estimated, 0);
    const sum: Tokens = { estimated: ofParts || Number(own.tokens_estimated ?? 0), used: Number(own.tokens_used ?? 0) + inside.reduce((n, t) => n + t.used, 0) };
    if (ofParts && inside.some((t) => !t.estimated || t.partial)) sum.partial = true;
    // What is finished has been paid for. Where nothing measured it, it is taken to have used what it was expected to.
    if (done(all.get(id)) && !sum.used && sum.estimated) Object.assign(sum, { used: sum.estimated, assumed: true });
    else if (inside.some((t) => t.assumed)) sum.assumed = true;
    totals.set(id, sum);
    return sum;
  };

  const blocked = await blockGraph(l);
  return {
    preset,
    focus: input.focus,
    truncated: total > GRAPH_LIMIT ? { shown: GRAPH_LIMIT, of: total } : undefined,
    nodes: [...keep].map((id) => {
      const e = eligible.get(id)!;
      return {
        id,
        type: e.type,
        root: l.registry.type(e.type)?.lineage.at(-1) ?? e.type,
        title: e.title,
        status: e.status,
        open: e.is_open,
        blocked: blocked.isBlocked(id),
        ...(work(e.type) && { work: true, tokens: tokens(id), estimated: e.props.tokens_estimated != null, order: e.props.order as number | undefined }),
      };
    }),
    edges: edges.map((e) => ({ id: e.id, type: e.type, from: e.from_id, to: e.to_id })),
  };
}

/**
 * A tree a pack declares over "is part of", from one root: its branches in
 * order, the work under each, progress rolled up from that work, and where
 * work is happening now. Without a root, the roots there are to choose from.
 */
async function tree(l: Lattice, input: { tree?: string; root?: string }) {
  const defs = l.registry.trees;
  const def = input.tree ? defs.get(input.tree) : defs.size === 1 ? [...defs.values()][0] : undefined;
  if (!def) throw new Error(`tree must be one of: ${[...defs.keys()].join(', ')}`);
  const isA = (type: string, kinds: string[]) => kinds.some((kind) => l.registry.isA(type, kind));
  const { rows: entities } = await l.db.query<Entity>(`select id, type, title, status, is_open, props, created_at from entity where archived_at is null`);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const { rows: links } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'part_of' and valid_to is null`);
  const kids = new Map<string, Entity[]>();
  for (const link of links) {
    const child = byId.get(link.from_id);
    if (child && byId.has(link.to_id)) kids.set(link.to_id, [...(kids.get(link.to_id) ?? []), child]);
  }
  const about = { id: def.id, title: def.title };
  if (!input.root) {
    const roots = entities
      .filter((e) => isA(e.type, def.roots))
      .map((e) => ({ id: e.id, type: e.type, title: e.title, status: e.status, branches: (kids.get(e.id) ?? []).filter((k) => isA(k.type, def.branches)).length }));
    return { tree: about, roots: roots.sort((a, b) => b.branches - a.branches || a.title.localeCompare(b.title)) };
  }
  const root = byId.get(input.root);
  if (!root) throw new Error(`No entity "${input.root}"`);

  const { rows: sessions } = await l.db.query<{ target: string; id: string; title: string }>(
    `select r.to_id as target, s.id, s.title from relation r join entity s on s.id = r.from_id
     where r.type = 'sys.works_on' and r.valid_to is null and s.is_open and s.archived_at is null`,
  );
  const blocked = await blockGraph(l);
  const item = (e: Entity) => {
    const on = sessions.filter((s) => s.target === e.id).map(({ id, title }) => ({ id, title }));
    return { id: e.id, type: e.type, title: e.title, status: e.status, open: e.is_open, blocked: blocked.isBlocked(e.id), sessions: on, active: on.length > 0 || def.active.includes(e.status) };
  };
  type Item = ReturnType<typeof item>;
  interface Branch extends Item {
    order: number | null;
    progress: { done: number; total: number };
    branches: Branch[];
    work: Item[];
  }
  const now: (Item & { path: string[] })[] = [];
  const place = (e: Entity) => (typeof e.props[def.order] === 'number' ? (e.props[def.order] as number) : null);
  const seen = new Set([root.id]);
  const build = (e: Entity, path: string[]): Branch => {
    // Each thing appears once. Branches are walked before work is counted, so
    // work that is part of both a branch and something above it sits under the branch.
    const claim = (wanted: (k: Entity) => boolean) => {
      const taken = (kids.get(e.id) ?? []).filter((k) => !seen.has(k.id) && wanted(k));
      for (const k of taken) seen.add(k.id);
      return taken;
    };
    const self = item(e);
    if (self.active && e !== root) now.push({ ...self, path });
    const here = e === root ? [] : [...path, e.title];
    // Placed branches first, in order; the rest after them, oldest first.
    const branches = claim((k) => isA(k.type, def.branches))
      .sort((a, b) => (place(a) ?? Infinity) - (place(b) ?? Infinity) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((k) => build(k, here));
    const work = claim((k) => isA(k.type, def.work)).map(item);
    now.push(...work.filter((w) => w.active).map((w) => ({ ...w, path: here })));
    const progress = branches.reduce((sum, b) => ({ done: sum.done + b.progress.done, total: sum.total + b.progress.total }), { done: work.filter((w) => !w.open).length, total: work.length });
    return { ...self, active: self.active || work.some((w) => w.active) || branches.some((b) => b.active), order: place(e), progress, branches, work };
  };
  const top = build(root, []);
  const { rows: depends } = await l.db.query<{ from: string; to: string }>(`select from_id as "from", to_id as "to" from relation where type = 'depends_on' and valid_to is null`);
  const flat = (b: Branch): Branch[] => [b, ...b.branches.flatMap(flat)];
  const by_status: Record<string, number> = {};
  for (const b of top.branches.flatMap(flat)) by_status[b.status] = (by_status[b.status] ?? 0) + 1;
  return {
    tree: about,
    root: { id: top.id, type: top.type, title: top.title, status: top.status },
    progress: top.progress,
    by_status,
    now,
    branches: top.branches,
    /** Work that belongs to the root but to no branch of it. */
    unplaced: top.work,
    /** What waits on what, within this tree: "from" cannot finish until "to" has. */
    depends: depends.filter((d) => seen.has(d.from) && seen.has(d.to)),
  };
}

/**
 * A project's open questions: the decisions not yet made and the hypotheses
 * not yet settled, each with what is waiting on it, most-blocking first, and
 * the ones settled lately. A question belongs to a project when it is part of
 * it, is about something in it, or something in it depends on or assumes it.
 * Without a project, the projects and how many open questions each has.
 */
async function questions(l: Lattice, input: { project?: string }) {
  const kindOf = (type: string) => (l.registry.isA(type, 'decision') ? 'decision' : l.registry.isA(type, 'hypothesis') ? 'hypothesis' : undefined);
  const { rows: entities } = await l.db.query<Entity>(`select id, type, title, body, status, is_open, props, updated_at from entity where archived_at is null`);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const { rows: links } = await l.db.query<{ type: string; from_id: string; to_id: string }>(
    `select type, from_id, to_id from relation where valid_to is null and type = any($1::text[])`,
    [['part_of', 'depends_on', 'assumes', 'about', 'tests', 'supports', 'refutes']],
  );
  const live = links.filter((r) => byId.has(r.from_id) && byId.has(r.to_id));
  /** Everything with this relation pointing at `to`. */
  const into = (type: string, to: string) => live.filter((r) => r.type === type && r.to_id === to).map((r) => byId.get(r.from_id)!);
  const scopeOf = (root: string) => {
    const scope = new Set([root]);
    const stack = [root];
    while (stack.length) {
      for (const child of into('part_of', stack.pop()!)) {
        if (scope.has(child.id)) continue;
        scope.add(child.id);
        stack.push(child.id);
      }
    }
    return scope;
  };
  const belonging = (scope: Set<string>) =>
    entities.filter(
      (e) =>
        kindOf(e.type) &&
        (scope.has(e.id) ||
          live.some((r) => (r.to_id === e.id && scope.has(r.from_id) && (r.type === 'depends_on' || r.type === 'assumes')) || (r.from_id === e.id && r.type === 'about' && scope.has(r.to_id)))),
    );
  const slim = (e: Entity) => ({ id: e.id, type: e.type, title: e.title, status: e.status, open: e.is_open });
  if (!input.project) {
    const projects = entities.filter((e) => l.registry.isA(e.type, 'project')).map((e) => ({ ...slim(e), questions: belonging(scopeOf(e.id)).filter((q) => q.is_open).length }));
    return { projects: projects.sort((a, b) => b.questions - a.questions || a.title.localeCompare(b.title)) };
  }
  const root = byId.get(input.project);
  if (!root) throw new Error(`No entity "${input.project}"`);

  const waitingOn = (id: string) => into('depends_on', id).filter((e) => e.is_open);
  /** How much open work sits behind this, counting what waits on what waits on it. */
  const behind = (id: string) => {
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length) {
      for (const e of waitingOn(stack.pop()!)) {
        if (e.id === id || seen.has(e.id)) continue;
        seen.add(e.id);
        stack.push(e.id);
      }
    }
    return seen.size;
  };
  const card = (q: Entity) => ({
    ...slim(q),
    kind: kindOf(q.type)!,
    body: q.body,
    due: (q.props.due as string | undefined) ?? null,
    options: Array.isArray(q.props.options) ? (q.props.options as unknown[]).map(String) : [],
    outcome: (q.props.outcome as string | undefined) ?? null,
    rationale: (q.props.rationale as string | undefined) ?? null,
    decided_on: (q.props.decided_on as string | undefined) ?? null,
    waiting: waitingOn(q.id).map(slim),
    holds_up: behind(q.id),
    assumed_by: into('assumes', q.id).map(slim),
    tests: into('tests', q.id).map(slim),
    // What the owner has asked to be looked into before deciding: tasks about the question.
    asks: into('about', q.id)
      .filter((e) => l.registry.isA(e.type, 'task'))
      .map((e) => ({ ...slim(e), body: e.body })),
    evidence: [...into('supports', q.id).map((e) => ({ ...slim(e), says: 'supports' })), ...into('refutes', q.id).map((e) => ({ ...slim(e), says: 'refutes' }))],
  });
  const mine = belonging(scopeOf(root.id));
  const open = mine
    .filter((q) => q.is_open)
    .map(card)
    .sort((a, b) => b.holds_up - a.holds_up || (a.due ?? '9').localeCompare(b.due ?? '9') || a.title.localeCompare(b.title));
  const settled = mine
    .filter((q) => !q.is_open)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 15)
    .map(card);
  return { project: slim(root), open, settled };
}

async function notifications(l: Lattice) {
  const { rows } = await l.db.query(
    `select n.id, n.title, n.body, n.props->>'level' as level, n.props->>'from' as from, n.created_at,
            a.id as about_id, a.title as about_title
     from entity n
     left join relation r on r.from_id = n.id and r.type = 'about' and r.valid_to is null
     left join entity a on a.id = r.to_id
     where n.type = any($1::text[]) and n.is_open and n.archived_at is null
     order by n.created_at desc limit 100`,
    [l.registry.family('sys.notification')],
  );
  return rows;
}

export interface View {
  description: string;
  run(l: Lattice, input: Record<string, unknown>): Promise<unknown>;
}

export const VIEWS: Record<string, View> = {
  needs_me: {
    description: 'What needs me now: my open tasks and decisions that nothing is blocking. Params: person (defaults to the workspace owner).',
    run: needsMe,
  },
  blocked_on_me: {
    description: 'What I am holding up: my open items that other work is waiting on, most-blocking first. Params: person.',
    run: blockedOnMe,
  },
  waiting_on: {
    description: 'What I am waiting on: my items blocked by someone else, and tasks others owe me. Params: person.',
    run: waitingOn,
  },
  changed_since: {
    description: 'What changed since a moment in time. Params: since (ISO date-time, required), limit.',
    run: changedSince,
  },
  at_risk: {
    description: 'What is about to go wrong: items due soon or overdue (and whether blocked), and work resting on a refuted hypothesis. Params: days (default 7).',
    run: atRisk,
  },
  blockers: {
    description: 'Every blocked item, what directly blocks it, and the root blockers that have to move first. Params: owner.',
    run: blockers,
  },
  graph: {
    description:
      'Nodes and edges for drawing the map. Params: relations (blocking, structure or all), focus (an entity id: show only its neighbourhood), depth (1 to 4, with focus), include_closed, include_system.',
    run: graph,
  },
  tree: {
    description:
      'A tree a pack declares over "is part of", such as software.roadmap: one root and its branches in order, the work under each, progress rolled up, and what is being worked on now. Params: root (an entity id; without it, the roots to choose from), tree (needed only when packs declare more than one).',
    run: tree,
  },
  questions: {
    description:
      'A project\'s open questions: decisions not yet made and hypotheses not yet settled, most-blocking first, each with what waits on it, its options, what is testing it, and anything the owner has asked an agent to look into first (`asks`: do those, write what you found into the notes or options of the question, and mark the ask done); then the ones settled lately with their outcome. Params: project (an entity id; without it, the projects and how many open questions each has).',
    run: questions,
  },
  notifications: {
    description: 'Unread notifications for the human, newest first.',
    run: notifications,
  },
  agent_usage: {
    description:
      'What agents have used in a repository: each run there that counted its tokens (a session on a machine, the sync agent in GitHub Actions), newest first, and the sum by where they ran over the last 7 and 30 days. Params: repo (required): its id, GitHub name or title; limit (runs listed, default 20).',
    run: agentUsage,
  },
  sessions: {
    description: 'Agent sessions and automation runs: what each open one is working on and holding, whether it has gone quiet, and the last ten that ended.',
    run: sessions,
  },
  brief: {
    description: 'Everything a session needs to start on one task: context, repository, blockers, resources it needs, and the rules that apply. Params: task (required).',
    run: brief,
  },
  repo_work: {
    description: 'Open tasks, decisions and issues belonging to whatever lives in a repository, split into ready and blocked, and when GitHub last reported a push to it. Params: repo (required): its id, its GitHub name "owner/name", or its title.',
    run: repoWork,
  },
  oldest: {
    description:
      'What may have gone stale: open tasks, decisions, issues, hypotheses, experiments and features nobody has changed or confirmed for longest, oldest first, each with when it was last known true. Params: days (only items older than this; default 14), repo (its id, GitHub name or title) or project (an id: only what is part of it), limit (default 20).',
    run: oldest,
  },
  recheck: {
    description:
      'What is due for a scheduled re-check in a repository: each project living there says how often its oldest items are re-checked (its recheck_days; weekly when not set, 0 for never), and for each that has waited that long, its open items nobody has changed or confirmed in that time, oldest first. Params: repo (required): its id, GitHub name or title, limit (items per project, default 25), now (true to be given the oldest items of every project there, whatever its interval and however new they are).',
    run: recheck,
  },
  available_now: {
    description: 'What can run right now: open tasks with nothing blocking them, tasks waiting only on a resource, and who holds each resource. Params: owner.',
    run: availableNow,
  },
};
