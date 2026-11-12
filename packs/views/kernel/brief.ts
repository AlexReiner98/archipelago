// The brief: everything a session needs to start on one task, as data and as text to paste. What it is part of,
// its repository, what blocks it, what it needs and who holds that, and what it rests on beyond structure. Answered
// from what the brief reads around the task (briefRead): the task, what holds it, and what they link to.

import type { KernelContext } from '#pelago/kernel';
import { BlockGraph, type Edge } from './blocks.ts';
import { findingLine, islandFindings } from './findings.ts';
import { byId as byIdOf } from './rows.ts';

/** What the brief's lens reads of an item (packs/surface/kernel/region.ts, Row): its note only where the lens starts. */
export interface Row {
  id: string;
  type: string;
  title: string;
  status: string;
  is_open: boolean;
  owner: string | null;
  props: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
  body?: string | null;
}

/** The type of an island, core's (packs/loader/kernel/island-items.ts). */
const ISLAND = 'island';
/** Where an instruction is said for files: `file:` and a glob (packs/agents/kernel/instructions.ts). */
const FILE = 'file:';
/** A path as globs read it: forward slashes, no leading ./ */
const slashed = (path: string) => path.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
/** A glob as a pattern: ** any folders, * any name within one, ? one character, the rest as written. */
const globRe = (glob: string) =>
  slashed(glob).replace(/[.+^${}()|[\]]/g, '\\$&').replace(/\*\*\/|\*\*|\*|\?/g, (m) => (m === '**/' ? '(?:.*/)?' : m === '**' ? '.*' : m === '*' ? '[^/]*' : '[^/]'));
/** Whether a glob names a path: the whole of it, or its end from a folder on (packs/agents/kernel/instructions.ts, globNames). */
const globNames = (glob: string, path: string) => new RegExp(`(^|/)${globRe(glob)}$`, 'i').test(slashed(path));

/** What a place is known by, as its own fields give it (address, folder): undefined for anything not known by either (packs/runs/kernel/places.ts, whereOf). */
function whereOf(ctx: KernelContext, e: Row): { address?: string; folder?: string } | undefined {
  const where = ctx.registry.type(e.type)?.capabilities.where;
  if (!where?.address && !where?.folder) return undefined;
  const field = (name: string | undefined) => (name && typeof e.props[name] === 'string' ? (e.props[name] as string) : undefined);
  return { address: field(where.address), folder: field(where.folder) };
}

/** An instruction as it is said (packs/agents/kernel/instructions.ts, Said): the files it names, its title and its way round. */
interface Trap { id: string; title: string; text: string; files?: string[] }

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
 * What a brief reads around its task (packs/surface/kernel/region.ts): what holds it, BRIEF_UP steps up; what it and those link to
 * by the links named (over); what it needs, with what that is tied to; and nothing linked to them.
 */
export async function briefRead(ctx: KernelContext, task: string, over: string[]): Promise<BriefRead> {
  const reg = ctx.registry;
  return (await ctx.reads({ region: { starts: [task], by: reg.relationFamily('part_of'), over: reg.relationFamily(...over), waits: [], up: BRIEF_UP, through: reg.relationFamily('needs'), narrow: true } })) as BriefRead;
}

const due = (e: Row) => (e.props.due == null ? null : String(e.props.due));

/** Everything a session needs to start on a task, as data and as text to paste, from what its lens read. */
export async function brief(ctx: KernelContext, input: { task?: string }, read: BriefRead) {
  const reg = ctx.registry;
  if (!input.task) throw new Error('brief needs "task": the id of the entity to work on');
  const byId = new Map(read.entities.map((e) => [e.id, e]));
  const task = byId.get(input.task);
  if (!task) throw new Error(`No item "${input.task}"`);
  const out = (types: string[], from: string[]) => read.relations.filter((r) => types.includes(r.type) && from.includes(r.from_id) && byId.has(r.to_id));
  // What items link to by a kind of link, flavours included, each once and in the order of their ids.
  const related = (root: string, from: string[]) => [...new Set(out(reg.relationFamily(root), from).map((r) => r.to_id))].sort().map((id) => byId.get(id)!);

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

  // Its repository: a place it or what holds it lives in that is known by an address or a folder; else such a place
  // that holds it (a task part of the repository itself).
  const [repo] = [...related('lives_in', ids), ...chain.slice(1)].filter((p) => whereOf(ctx, p));
  const needs = related('needs', [task.id]);
  // What the task rests on beyond structure (a rule that governs it, an issue it addresses, a question it assumes), by
  // the kind of link. From what holds it or what it needs, only questions and records: the rules and the decisions.
  const kinds = reg.relationFamily('link', 'about', 'bears_on').filter((t) => t !== 'produced');
  // A question: something to answer, not work to plan.
  const question = (type: string) => { const c = reg.type(type)?.capabilities; return Boolean(c?.actionable && !c.plannable); };
  const tiedBy = new Map<string, { rel: string; near: boolean; e: Row }>();
  for (const r of out(kinds, [...ids, ...needs.map((n) => n.id)])) {
    const key = `${r.type} ${r.to_id}`;
    const near = r.from_id === task.id;
    if (!tiedBy.has(key) || near) tiedBy.set(key, { rel: r.type, near, e: byId.get(r.to_id)! });
  }
  const ties = [...tiedBy.values()].sort((a, b) => a.rel.localeCompare(b.rel) || a.e.id.localeCompare(b.e.id)).filter((t) => t.near || question(t.e.type) || reg.isA(t.e.type, 'record'));
  // A tie with no outcome says what it is in its note: read for those alone.
  const bare = ties.filter((t) => !t.e.props.outcome).map((t) => t.e.id);
  const notes = new Map([...(await byIdOf(ctx, bare)).values()].map((r) => [r.id, r.body]));
  const graph = new BlockGraph((await ctx.reads({ blocks: [task.id] })) as Edge[]);
  const roots = graph.roots(task.id);
  const asBrief = (e: Row): Brief => ({ id: e.id, type: e.type, title: e.title, status: e.status, owner: e.owner, due: due(e) });
  const names = new Map([...(graph.direct.get(task.id) ?? []).map((e) => e.y), ...roots].flatMap((id) => (byId.has(id) ? [[id, asBrief(byId.get(id)!)] as const] : [])));
  const unread = roots.filter((id) => !names.has(id));
  if (unread.length) for (const r of (await byIdOf(ctx, unread)).values()) names.set(r.id, { id: r.id, type: r.type, title: r.title, status: r.status, owner: r.owner, due: r.props?.due == null ? null : typeof r.props.due === 'string' ? r.props.due : JSON.stringify(r.props.due) });
  const blockedBy = (graph.direct.get(task.id) ?? []).map((e) => ({ why: e.why, entity: names.get(e.y) }));
  const held = needs.length ? ((await ctx.reads({ holds: needs.map((n) => n.id) })) as { resource: string; held_by_title: string }[]).map((h) => ({ to_id: h.resource, title: h.held_by_title })) : [];

  const lines = [`# ${task.title}`, `${reg.type(task.type)?.title ?? task.type}, ${task.status}. Archipelago id: ${task.id}`];
  if (task.body) lines.push('', task.body);
  if (chain.length > 1) lines.push('', `Part of: ${chain.slice(1).map((c) => c.title).join(' > ')}`);
  const at = repo && whereOf(ctx, repo);
  if (repo) lines.push(`Repository: ${repo.title} (${at?.folder ?? at?.address ?? 'no path recorded'})`);
  if (roots.length) {
    lines.push('', '## Blocked', 'This cannot finish until:');
    for (const id of roots) lines.push(`- ${names.get(id)?.title} (${names.get(id)?.type}, ${names.get(id)?.status})`);
  }
  if (needs.length) {
    lines.push('', '## Needs');
    for (const n of needs) {
      const holder = held.find((h) => h.to_id === n.id);
      lines.push(`- ${n.title}: ${n.status}${holder ? `, held by ${holder.title}` : ''}${(reg.capacity(n) ?? Infinity) === Infinity ? '' : ' (exclusive: claim it before use, release it after)'}`);
    }
  }
  for (const rel of new Set(ties.map((t) => t.rel))) {
    const title = reg.relations.get(rel)?.title ?? rel;
    lines.push('', `## ${title[0].toUpperCase()}${title.slice(1)}`);
    for (const { e: r } of ties.filter((t) => t.rel === rel)) lines.push(`- ${r.title} (${r.status})${r.props.outcome ? ` ${r.props.outcome}` : ''}${r.props.rationale ? ` Why: ${r.props.rationale}` : ''}${!r.props.outcome && notes.get(r.id) ? `: ${notes.get(r.id)}` : ''}`);
  }
  // What bites in the files of its repository: the instructions said for files there, each with the files it names.
  // Each is named; the way round is said for the files the task names (all of them, when it names none), since the
  // rest is said whole when a session opens one of its files. Most of a brief was traps of files the work never opened.
  // An island is read for what it publishes: its findings, one line each, in place of the traps and the reporting a
  // task's brief gives a session about to work on it (task e_p27ddjqt).
  const island = reg.isA(task.type, ISLAND);
  const found = island ? await islandFindings(ctx, task.id) : undefined;
  // What it stands by first, whole; its working findings apart after, a few.
  if (found) {
    const { published: p, working: w } = found;
    lines.push('', `## Published (${p.rows.length + p.more})`, ...(p.rows.length ? p.rows.map(findingLine) : ['None: no finding here is marked published.']));
    if (p.more) lines.push(`- and ${p.more} more`);
    if (w.rows.length) lines.push('', `## Working, read here only (${w.rows.length + w.more})`, ...w.rows.map(findingLine), ...(w.more ? [`- and ${w.more} more`] : []));
  }
  const traps = island ? [] : ((await ctx.reads({ instructions: { where: FILE, ...(repo && { about: repo.id }) } })) as Trap[]);
  const named = task.body?.match(/[\w.*-]+(?:\/[\w.*-]+)+|[\w*-]+\.(?:[cm]?[jt]s|json|css|html|md|sql|ya?ml|py|cs)\b/gi) ?? [];
  const bites = (t: (typeof traps)[number]) => !named.length || t.files!.some((g) => named.some((p) => globNames(g, p) || globNames(p, g)));
  if (traps.length) lines.push('', '## Where it bites', ...traps.map((t) => `- ${t.files!.join(', ')}: ${t.title}.${bites(t) ? ` ${t.text}` : ''}`));
  if (!island) lines.push('', '## Reporting', `Register with pelago (capture, action session_start, task ${task.id}, with your git branch), note anything worth knowing with report, action session_update, and call report, action session_end, with a summary when done.`);

  const slim = (e: Row) => ({ id: e.id, type: e.type, title: e.title, status: e.status });
  return {
    task: slim(task),
    part_of: chain.slice(1).map(slim),
    repo: repo && { ...slim(repo), path: repo.props.path, address: at?.address },
    blocked_by: blockedBy,
    root_blockers: roots.map((id) => names.get(id)),
    needs: needs.map((n) => ({ ...slim(n), exclusive: (reg.capacity(n) ?? Infinity) !== Infinity, held_by: held.find((h) => h.to_id === n.id)?.title })),
    ties: ties.map(({ rel, e }) => ({ relation: rel, ...slim(e) })),
    ...(found && { findings: found.published.rows, ...(found.published.more > 0 && { findings_more: found.published.more }), ...(found.working.rows.length > 0 && { working: found.working.rows }), ...(found.working.more > 0 && { working_more: found.working.more }) }),
    ...(traps.length > 0 && { traps: traps.map(({ id, title, files }) => ({ id, title, files })) }),
    text: lines.join('\n'),
  };
}
