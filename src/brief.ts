// The brief: everything a session needs to start on one task, as data and as text to paste. What it is part of,
// its repository, what blocks it, what it needs and who holds that, and what it rests on beyond structure. Answered
// from what the brief reads around the task (briefRead): the task, what holds it, and what they link to.

import { commitRule } from './commit-rule.ts';
import { blockGraph } from './blocking.ts';
import { scanAround, type Row } from './region.ts';
import { whereOf } from './places.ts';
import { ACTIVE_HOLDS, type Entity, type Archipelago } from './pelago.ts';

interface Brief {
  id: string;
  type: string;
  title: string;
  status: string;
  owner: string | null;
  due: string | null;
}

/** What the brief's lens read: the items around the task, the task's note, and the links among them. */
export interface BriefRead {
  entities: Row[];
  relations: { type: string; from_id: string; to_id: string }[];
}

/** How far up what holds a task the brief reads: what it is part of, outwards. */
export const BRIEF_UP = 6;

/**
 * What a brief reads around its task (src/region.ts): what holds it, BRIEF_UP steps up; what it and those link to
 * by the links named (over); what it needs, with what that is tied to; and nothing linked to them.
 */
export function briefRead(l: Archipelago, task: string, over: string[]) {
  const reg = l.registry;
  return scanAround(l, { starts: [task], by: reg.relationFamily('part_of'), over: reg.relationFamily(...over), waits: [], up: BRIEF_UP, through: reg.relationFamily('needs'), narrow: true });
}

const due = (e: Row) => (e.props.due == null ? null : String(e.props.due));

/** Everything a session needs to start on a task, as data and as text to paste, from what its lens read. */
export async function brief(l: Archipelago, input: { task?: string }, read: BriefRead) {
  if (!input.task) throw new Error('brief needs "task": the id of the entity to work on');
  const byId = new Map(read.entities.map((e) => [e.id, e]));
  const task = byId.get(input.task);
  if (!task) throw new Error(`No item "${input.task}"`);
  const out = (types: string[], from: string[]) => read.relations.filter((r) => types.includes(r.type) && from.includes(r.from_id) && byId.has(r.to_id));
  // What items link to by a kind of link, flavours included, each once and in the order of their ids.
  const related = (root: string, from: string[]) => [...new Set(out(l.registry.relationFamily(root), from).map((r) => r.to_id))].sort().map((id) => byId.get(id)!);

  // The task, then what it is part of, outwards: of two, the one that is itself part of something.
  const chain: Row[] = [task];
  for (let at = task.id; chain.length <= BRIEF_UP; ) {
    const ups = out(['part_of'], [at]).map((r) => byId.get(r.to_id)!).filter((e) => !chain.includes(e));
    const next = ups.find((e) => out(['part_of'], [e.id]).length) ?? ups[0];
    if (!next) break;
    chain.push(next);
    at = next.id;
  }
  const ids = chain.map((c) => c.id);

  // Its repository: a place it or what holds it lives in that is known by an address or a folder.
  const [repo] = related('lives_in', ids).filter((p) => whereOf(l, p as unknown as Entity));
  const needs = related('needs', [task.id]);
  // What the task rests on beyond structure (a rule that governs it, an issue it addresses, a question it assumes), by
  // the kind of link. From what holds it or what it needs, only questions and records: the rules and the decisions.
  const kinds = l.registry.relationFamily('link', 'about', 'bears_on').filter((t) => t !== 'produced');
  const tiedBy = new Map<string, { rel: string; near: boolean; e: Row }>();
  for (const r of out(kinds, [...ids, ...needs.map((n) => n.id)])) {
    const key = `${r.type} ${r.to_id}`;
    const near = r.from_id === task.id;
    if (!tiedBy.has(key) || near) tiedBy.set(key, { rel: r.type, near, e: byId.get(r.to_id)! });
  }
  const ties = [...tiedBy.values()].sort((a, b) => a.rel.localeCompare(b.rel) || a.e.id.localeCompare(b.e.id)).filter((t) => t.near || ['question', 'record'].some((k) => l.registry.isA(t.e.type, k)));
  // A tie with no outcome says what it is in its note: read for those alone.
  const bare = ties.filter((t) => !t.e.props.outcome).map((t) => t.e.id);
  const notes = new Map(bare.length ? (await l.db.query<{ id: string; body: string }>(`select id, body from entity where id = any($1::text[])`, [bare])).rows.map((r) => [r.id, r.body]) : []);
  const graph = await blockGraph(l, [task.id]);
  const roots = graph.roots(task.id);
  const asBrief = (e: Row): Brief => ({ id: e.id, type: e.type, title: e.title, status: e.status, owner: e.owner, due: due(e) });
  const names = new Map([...(graph.direct.get(task.id) ?? []).map((e) => e.y), ...roots].flatMap((id) => (byId.has(id) ? [[id, asBrief(byId.get(id)!)] as const] : [])));
  const unread = roots.filter((id) => !names.has(id));
  if (unread.length) for (const r of (await l.db.query<Brief>(`select id, type, title, status, owner, props->>'due' as due from entity where id = any($1::text[])`, [unread])).rows) names.set(r.id, r);
  const blockedBy = (graph.direct.get(task.id) ?? []).map((e) => ({ why: e.why, entity: names.get(e.y) }));
  const { rows: held } = needs.length
    ? await l.db.query<{ to_id: string; title: string }>(`select h.to_id, h.holder_title as title from ${ACTIVE_HOLDS} h where h.to_id = any($1::text[])`, [needs.map((n) => n.id)])
    : { rows: [] };

  const lines = [`# ${task.title}`, `${l.registry.type(task.type)?.title ?? task.type}, ${task.status}. Archipelago id: ${task.id}`];
  if (task.body) lines.push('', task.body);
  if (chain.length > 1) lines.push('', `Part of: ${chain.slice(1).map((c) => c.title).join(' > ')}`);
  const at = repo && whereOf(l, repo as unknown as Entity);
  if (repo) lines.push(`Repository: ${repo.title} (${at?.folder ?? at?.address ?? 'no path recorded'})`);
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
    for (const { e: r } of ties.filter((t) => t.rel === rel)) lines.push(`- ${r.title} (${r.status})${r.props.outcome ? ` ${r.props.outcome}` : ''}${r.props.rationale ? ` Why: ${r.props.rationale}` : ''}${!r.props.outcome && notes.get(r.id) ? `: ${notes.get(r.id)}` : ''}`);
  }
  lines.push('', '## Reporting', `Register with pelago (capture, action session_start, task ${task.id}, with your git branch), note anything worth knowing with report, action session_update, and call report, action session_end, with a summary when done. ${commitRule(task.id)}`);

  const slim = (e: Row) => ({ id: e.id, type: e.type, title: e.title, status: e.status });
  return {
    task: slim(task),
    part_of: chain.slice(1).map(slim),
    repo: repo && { ...slim(repo), path: repo.props.path },
    blocked_by: blockedBy,
    root_blockers: roots.map((id) => names.get(id)),
    needs: needs.map((n) => ({ ...slim(n), exclusive: l.registry.capacity(n) !== Infinity, held_by: held.find((h) => h.to_id === n.id)?.title })),
    ties: ties.map(({ rel, e }) => ({ relation: rel, ...slim(e) })),
    text: lines.join('\n'),
  };
}
