// The brief: everything a session needs to start on one task, as data and as text to paste. What it is part of,
// its repository, what blocks it, what it needs and who holds that, and what it rests on beyond structure.

import { commitRule } from './commit-rule.ts';
import { blockGraph } from './blocking.ts';
import { ACTIVE_HOLDS, type Entity, type Archipelago } from './pelago.ts';

interface Brief {
  id: string;
  type: string;
  title: string;
  status: string;
  owner: string | null;
  due: string | null;
}

async function briefs(l: Archipelago, ids: Iterable<string>): Promise<Map<string, Brief>> {
  const list = [...new Set(ids)];
  if (!list.length) return new Map();
  const { rows } = await l.db.query<Brief>(
    `select id, type, title, status, owner, props->>'due' as due from entity where id = any($1::text[])`,
    [list],
  );
  return new Map(rows.map((r) => [r.id, r]));
}

/** Everything a session needs to start on a task, as data and as text to paste. */
export async function brief(l: Archipelago, input: { task?: string }) {
  if (!input.task) throw new Error('brief needs "task": the id of the entity to work on');
  const task = await l.entity(input.task);
  if (!task) throw new Error(`No item "${input.task}"`);

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
        `select distinct e.* from relation r join entity e on e.id = r.to_id where r.type = any($1::text[]) and r.from_id = any($2::text[]) and r.valid_to is null and e.archived_at is null`,
        [l.registry.relationFamily(type), from],
      )
    ).rows;

  const [repo] = l.registry.relations.has('software.lives_in') ? await related('software.lives_in', ids) : [];
  const needs = await related('needs', [task.id]);
  // What the task rests on beyond structure (a rule that governs it, an issue it addresses, a question it assumes), by
  // the kind of link. From what holds it or what it needs, only questions and records: the rules and the decisions.
  const { rows: tied } = await l.db.query<Entity & { rel: string; near: boolean }>(
    `select distinct on (r.type, e.id) r.type as rel, r.from_id = $1 as near, e.* from relation r join entity e on e.id = r.to_id
     where r.from_id = any($2::text[]) and r.valid_to is null and e.archived_at is null and r.type = any($3::text[]) order by r.type, e.id, near desc`,
    [task.id, [...ids, ...needs.map((n) => n.id)], l.registry.relationFamily('relates_to', 'about', 'bears_on').filter((t) => t !== 'produced')],
  );
  const ties = tied.filter((t) => t.near || ['question', 'record'].some((k) => l.registry.isA(t.type, k)));
  const graph = await blockGraph(l);
  const roots = graph.roots(task.id);
  const names = await briefs(l, [...(graph.direct.get(task.id) ?? []).map((e) => e.y), ...roots]);
  const blockedBy = (graph.direct.get(task.id) ?? []).map((e) => ({ why: e.why, entity: names.get(e.y) }));
  const { rows: held } = await l.db.query<{ to_id: string; title: string }>(
    `select h.to_id, h.holder_title as title from ${ACTIVE_HOLDS} h where h.to_id = any($1::text[])`,
    [needs.map((n) => n.id)],
  );

  const lines = [`# ${task.title}`, `${l.registry.type(task.type)?.title ?? task.type}, ${task.status}. Archipelago id: ${task.id}`];
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
      lines.push(`- ${n.title}: ${n.status}${holder ? `, held by ${holder.title}` : ''}${l.registry.capacity(n) === Infinity ? '' : ' (exclusive: claim it before use, release it after)'}`);
    }
  }
  for (const rel of new Set(ties.map((t) => t.rel))) {
    const title = l.registry.relations.get(rel)?.title ?? rel;
    lines.push('', `## ${title[0].toUpperCase()}${title.slice(1)}`);
    for (const r of ties.filter((t) => t.rel === rel)) lines.push(`- ${r.title} (${r.status})${r.props.outcome ? ` ${r.props.outcome}` : ''}${r.props.rationale ? ` Why: ${r.props.rationale}` : ''}${!r.props.outcome && r.body ? `: ${r.body}` : ''}`);
  }
  lines.push('', '## Reporting', `Register with pelago (session_start, task ${task.id}, with your git branch), note anything worth knowing with session_update, and call session_end with a summary when done. ${commitRule(task.id)}`);

  const slim = (e: Entity) => ({ id: e.id, type: e.type, title: e.title, status: e.status });
  return {
    task: slim(task),
    part_of: chain.slice(1).map(slim),
    repo: repo && { ...slim(repo), path: repo.props.path },
    blocked_by: blockedBy,
    root_blockers: roots.map((id) => names.get(id)),
    needs: needs.map((n) => ({ ...slim(n), exclusive: l.registry.capacity(n) !== Infinity, held_by: held.find((h) => h.to_id === n.id)?.title })),
    ties: ties.map((t) => ({ relation: t.rel, ...slim(t) })),
    text: lines.join('\n'),
  };
}
