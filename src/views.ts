// Views: the questions the map exists to answer. Nothing here is stored;
// blockers are derived from relations every time, so they cannot go stale.

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

/** Open work that belongs to whatever lives in a repository, split by whether it can run now. */
async function repoWork(l: Lattice, input: { repo?: string }) {
  if (!input.repo) throw new Error('repo_work needs "repo": the id of a repository');
  const graph = await blockGraph(l);
  const { rows } = await l.db.query<Brief>(
    `with recursive scope(id) as (
       select from_id from relation where type = 'software.lives_in' and to_id = $1 and valid_to is null
       union
       select r.from_id from relation r join scope s on r.to_id = s.id where r.type = 'part_of' and r.valid_to is null
     )
     select e.id, e.type, e.title, e.status, e.owner, e.props->>'due' as due
     from entity e join scope s on s.id = e.id
     where e.is_open and e.archived_at is null and e.type = any($2::text[])
     order by e.props->>'due' nulls last, e.updated_at desc`,
    [input.repo, [...l.registry.family('task'), ...l.registry.family('decision')]],
  );
  const names = await briefs(l, rows.flatMap((r) => graph.roots(r.id)));
  return {
    ready: rows.filter((r) => !graph.isBlocked(r.id)),
    blocked: rows.filter((r) => graph.isBlocked(r.id)).map((r) => ({ ...r, waiting_on: graph.roots(r.id).map((id) => names.get(id)?.title) })),
  };
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
  const { rows: entities } = await l.db.query<Entity>(`select id, type, title, status, is_open from entity where archived_at is null`);
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

  const blocked = await blockGraph(l);
  return {
    preset,
    focus: input.focus,
    truncated: total > GRAPH_LIMIT ? { shown: GRAPH_LIMIT, of: total } : undefined,
    nodes: [...keep].map((id) => {
      const e = eligible.get(id)!;
      return { id, type: e.type, root: l.registry.type(e.type)?.lineage.at(-1) ?? e.type, title: e.title, status: e.status, open: e.is_open, blocked: blocked.isBlocked(id) };
    }),
    edges: edges.map((e) => ({ id: e.id, type: e.type, from: e.from_id, to: e.to_id })),
  };
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
  notifications: {
    description: 'Unread notifications for the human, newest first.',
    run: notifications,
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
    description: 'Open tasks and decisions belonging to whatever lives in a repository, split into ready and blocked. Params: repo (required).',
    run: repoWork,
  },
  available_now: {
    description: 'What can run right now: open tasks with nothing blocking them, tasks waiting only on a resource, and who holds each resource. Params: owner.',
    run: availableNow,
  },
};
