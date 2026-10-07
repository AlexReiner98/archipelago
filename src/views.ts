// Views: the questions the map exists to answer. Nothing here is stored;
// blockers are derived from relations every time, so they cannot go stale.

import type { Lattice } from './lattice.ts';

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
    join relation h on h.to_id = n.to_id and h.type = 'holds' and h.valid_to is null
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

async function blockGraph(l: Lattice): Promise<BlockGraph> {
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
  const id = given ?? (await l.setting<string>('me'));
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
    `select res.id as resource, res.title, h.from_id as held_by, e.title as held_by_title, h.props->>'for' as held_for, h.valid_from as since
     from relation h join entity res on res.id = h.to_id join entity e on e.id = h.from_id
     where h.type = 'holds' and h.valid_to is null`,
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
  available_now: {
    description: 'What can run right now: open tasks with nothing blocking them, tasks waiting only on a resource, and who holds each resource. Params: owner.',
    run: availableNow,
  },
};
