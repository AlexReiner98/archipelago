// The graph view: nodes and edges for drawing the map, around a focus or from the newest links of each kind, each
// node with its tokens rolled up over everything that is part of it. Read on its own: a walk from the focus, or the
// newest links; no lens.

import { blockGraph } from './blocking.ts';
import type { ViewDef } from './declared.ts';
import { SYSTEM } from './head.ts';
import type { Archipelago } from './pelago.ts';

/** The fields one value of a param stands for, as the preset declares them. */
function chosen(def: ViewDef, param: string, value: string): Record<string, unknown> {
  const choices = def.choices?.[param] ?? {};
  if (!(value in choices)) throw new Error(`\`${param}\` must be one of: ${Object.keys(choices).join(', ')}`);
  return choices[value];
}

/** Each kind of link a preset names, with every kind of link that extends it. */
const family = (l: Archipelago, over: unknown) => (Array.isArray(over) ? l.registry.relationFamily(...over.map(String)) : over);

type Node = { id: string; type: string; root: string; kind: string | null; title: string; status: string; open: boolean; blocked: boolean };

/** The items a graph is drawn from (those `keep` keeps, a condition on them), with whether each is blocked. */
async function nodesOf(l: Archipelago, ids: string[], keep = ''): Promise<Node[]> {
  const { rows } = await l.db.query<{ id: string; type: string; title: string; status: string; is_open: boolean }>(`select id, type, title, status, is_open from entity where id = any($1::text[]) and archived_at is null${keep ? ` and ${keep}` : ''}`, [ids]);
  const blocked = await blockGraph(l, rows.map((e) => e.id));
  return rows.map((e) => ({ id: e.id, type: e.type, ...l.registry.ancestry(e.type), title: e.title, status: e.status, open: e.is_open, blocked: blocked.isBlocked(e.id) }));
}

/**
 * What a focus is tied to, `steps` steps along the links named either way (every kind when `over` is "all"), through
 * what is not folded away: the focus itself is kept whatever it is.
 */
async function near(l: Archipelago, focus: string, over: unknown, fold: string[], steps: number) {
  const types = Array.isArray(over) ? (over as string[]) : null;
  const keep = ['e.archived_at is null', fold.includes('closed') && 'e.is_open', fold.includes('system') && `(e.kind is null or e.kind <> '${SYSTEM}')`].filter(Boolean).join(' and ');
  const seen = new Set([focus]);
  for (let level = [focus], n = 0; level.length && n < steps; n++) {
    const way = (from: string, to: string) => `select r.${to} as id from relation r join unnest($1::text[]) s(id) on s.id = r.${from} join entity e on e.id = r.${to} where r.valid_to is null${types ? ' and r.type = any($2::text[])' : ''} and ${keep}`;
    const { rows } = await l.db.query<{ id: string }>(`${way('from_id', 'to_id')} union ${way('to_id', 'from_id')}`, types ? [level, types] : [level]);
    level = rows.map((r) => r.id).filter((id) => !seen.has(id) && seen.add(id));
  }
  const items = await nodesOf(l, [...seen]);
  if (!items.some((i) => i.id === focus)) throw new Error(`No item "${focus}"`);
  return { lens: { over: types ?? ('all' as const) }, items };
}

/** The most nodes a graph sends. */
const GRAPH_LIMIT = 400;

/**
 * Nodes and edges: what is tied by the links the preset's `relations` names, from a focus `near` steps either way or
 * the whole map, each node with its tokens rolled up over everything that is part of it.
 */
export async function graph(l: Archipelago, def: ViewDef, params: Record<string, unknown>) {
  const focus = params.focus === undefined ? undefined : String(params.focus);
  const preset = String(params.relations ?? (focus ? 'all' : 'blocking'));
  const fold = [...(params.include_closed ? [] : ['closed']), ...(params.include_system ? [] : ['system'])];
  const over = family(l, chosen(def, 'relations', preset).over);
  const steps = Math.min(Math.max(Number(params.depth ?? 2) || 2, 1), 4);
  // Without a focus, the newest links of the kinds asked, and what they join: the whole map is never read.
  const answer = focus ? await near(l, focus, over, fold, steps) : await newest(l, over, fold);
  const sent = new Map(answer.items.map((i) => [i.id, i]));
  // The links among them as the map keeps them, in the order it keeps them, which decides what a graph too big to
  // send keeps: walked out from the focus a step at a time, or, without one, as the links come.
  const types = answer.lens.over === 'all' ? null : answer.lens.over;
  const ids = [...sent.keys()];
  const { rows: links } = await l.db.query<{ id: string; type: string; from_id: string; to_id: string }>(
    `with s(id) as (select unnest($1::text[])) select r.id, r.type, r.from_id, r.to_id from relation r join s a on a.id = r.from_id join s b on b.id = r.to_id where r.valid_to is null${types ? ' and r.type = any($2::text[])' : ''} order by ${focus ? 'r.ctid' : 'r.valid_from desc, r.id'}`,
    types ? [ids, types] : [ids],
  );
  let order: string[];
  if (focus) {
    const keep = new Set([focus]);
    for (let d = 0, frontier = [focus]; d < steps && frontier.length; d++) {
      const next: string[] = [];
      for (const r of links) for (const [x, y] of [[r.from_id, r.to_id], [r.to_id, r.from_id]]) if (frontier.includes(x) && !keep.has(y)) (keep.add(y), next.push(y));
      frontier = next;
    }
    order = [...keep];
  } else order = [...new Set(links.flatMap((r) => [r.from_id, r.to_id]))].filter((id) => sent.has(id));
  const nodes = order.slice(0, GRAPH_LIMIT).map((id) => sent.get(id)!);
  const kept = new Set(nodes.map((n) => n.id));
  const tokens = await rolledTokens(l, nodes.map((n) => n.id));
  return {
    preset,
    focus,
    truncated: order.length > GRAPH_LIMIT ? { shown: GRAPH_LIMIT, of: order.length } : undefined,
    nodes: nodes.map((i) => {
      const t = tokens.of(i.id);
      return { id: i.id, type: i.type, root: i.root, kind: i.kind, title: i.title, status: i.status, open: i.open, created: t?.created, blocked: i.blocked, ...(t?.work && { work: true, tokens: t.tokens, estimated: t.estimated, order: t.order }) };
    }),
    edges: links.filter((r) => kept.has(r.from_id) && kept.has(r.to_id)).map((r) => ({ id: r.id, type: r.type, from: r.from_id, to: r.to_id })),
  };
}

/** The most links a graph with no focus reads of each kind: the newest, by the index on open links of a kind. */
const NEWEST_LINKS = GRAPH_LIMIT;

/** What a graph with no focus is drawn from: the newest open links of each kind asked, and the items they join, folded as asked. */
async function newest(l: Archipelago, over: unknown, fold: string[]) {
  const kinds = Array.isArray(over) ? (over as string[]) : [...l.registry.relations.keys()];
  const ends = new Set<string>();
  for (const type of kinds) {
    const { rows } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = $1 and valid_to is null order by valid_from desc limit ${NEWEST_LINKS}`, [type]);
    for (const r of rows) ends.add(r.from_id).add(r.to_id);
  }
  const keep = [fold.includes('closed') && 'is_open', fold.includes('system') && `(kind is null or kind <> '${SYSTEM}')`].filter(Boolean).join(' and ');
  return { lens: { over: Array.isArray(over) ? (over as string[]) : ('all' as const) }, items: await nodesOf(l, [...ends], keep) };
}

/**
 * Tokens: what each thing is expected to take and has taken, with everything that is part of it, in sight or not.
 * A thing with parts is expected to take the sum of what they are; its own estimate stands only while none of its
 * parts has one. Where some parts have an estimate and some have not, the sum is short, and says so (`partial`).
 */
async function rolledTokens(l: Archipelago, nodes: string[]) {
  // Only work is counted: what can be estimated, and what such things are part of. And the nodes, for when each was made.
  const work = (type: string) => Boolean(l.registry.type(type)?.fields.tokens_estimated) || l.registry.isA(type, 'work');
  // Everything that is part of the nodes, a level at a time: all a roll-up of them reads.
  const parts: { from_id: string; to_id: string }[] = [];
  const seen = new Set(nodes);
  for (let level = nodes; level.length; ) {
    const { rows: found } = await l.db.query<{ from_id: string; to_id: string }>(`select r.from_id, r.to_id from relation r join unnest($1::text[]) s(id) on s.id = r.to_id where r.type = 'part_of' and r.valid_to is null`, [level]);
    parts.push(...found);
    level = [...new Set(found.map((r) => r.from_id))].filter((id) => !seen.has(id) && seen.add(id));
  }
  const { rows } = await l.db.query<{ id: string; type: string; status: string; is_open: boolean; created_at: Date; estimated: unknown; used: unknown; place: unknown }>(
    `select e.id, e.type, e.status, e.is_open, e.created_at, e.props->'tokens_estimated' as estimated, e.props->'tokens_used' as used, e.props->'order' as place from entity e join unnest($1::text[]) s(id) on s.id = e.id where e.archived_at is null`,
    [[...seen]],
  );
  const all = new Map(rows.map((e) => [e.id, e]));
  const partsOf = new Map<string, string[]>();
  for (const p of parts) if (all.has(p.from_id)) partsOf.set(p.to_id, [...(partsOf.get(p.to_id) ?? []), p.from_id]);
  type Tokens = { estimated: number; used: number; assumed?: boolean; partial?: boolean };
  const totals = new Map<string, Tokens>();
  // A feature that is built is done, though it stays open until it ships.
  const done = (id: string) => Boolean(all.get(id)) && (!all.get(id)!.is_open || all.get(id)!.status === 'built');
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
    const own = all.get(id);
    const ofParts = inside.reduce((n, t) => n + t.estimated, 0);
    const sum: Tokens = { estimated: ofParts || Number(own?.estimated ?? 0), used: Number(own?.used ?? 0) + inside.reduce((n, t) => n + t.used, 0) };
    if (ofParts && inside.some((t) => !t.estimated || t.partial)) sum.partial = true;
    // What is finished has been paid for. Where nothing measured it, it is taken to have used what it was expected to.
    if (done(id) && !sum.used && sum.estimated) Object.assign(sum, { used: sum.estimated, assumed: true });
    else if (inside.some((t) => t.assumed)) sum.assumed = true;
    totals.set(id, sum);
    return sum;
  };
  return {
    of: (id: string) => {
      const e = all.get(id);
      if (!e) return undefined;
      const isWork = work(e.type);
      return { created: e.created_at, work: isWork, ...(isWork && { tokens: tokens(id), estimated: e.estimated != null, order: typeof e.place === 'number' ? e.place : undefined }) };
    },
  };
}

