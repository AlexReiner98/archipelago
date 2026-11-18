// The rule forms that read links (the build round, feature e_jmxzebgh): at most n links into an item (at_most), an
// item that must hold a link (must_link), and a rule that applies unless what a walk from the item reaches holds
// (unless). Each is data in a pack's rules (RuleDef, ./rules.ts), checked as the pack loads (checkForms, checkUnless,
// called by packs/loader/kernel/rule-check.ts) and judged in decide: at_most and must_link refuse whatever sends the
// change, as unique does; unless spares a hold or a refusal its condition meets (./rules.ts, judge).

import type { Q } from '../../database/kernel/db.ts';
import type { Registry } from '../../loader/kernel/packs.ts';
import type { RuleDef } from './rules.ts';

type OneOrMany = string | string[];
const list = (x: OneOrMany | undefined) => (x === undefined ? undefined : Array.isArray(x) ? x : [x]);

/** At most n open links of a type (flavours included) into an item of the rule's type; a link from a closed or archived item holds nothing. */
export interface AtMost { link: string; n: number }
/** An item of the rule's type holds a link of a type: out to an item of `to`, or in from an item of `from` ("*" for any). Neither: out, to anything. */
export interface MustLink { link: string; to?: string; from?: string }
/** What a walk from the item reaches, and what must hold of it: `every` (the default) item, `some`, or `none`. */
export interface Unless {
  /** A link type and its way: "part_of<" the items linked into it, "depends_on>" (or bare) the items it links to. */
  walk: string;
  /** How many links deep, 1 to 5; 1 left out. */
  steps?: number;
  /** Only the items of this type (flavours included) count. */
  type?: string;
  holds: { status?: OneOrMany; fields?: Record<string, unknown> };
  count?: 'every' | 'some' | 'none';
}

export const MAX_STEPS = 5;
const WALK = /^([a-z][a-z0-9_.]*)([<>]?)$/;
type Checked = Pick<Registry, 'types'> & Partial<Pick<Registry, 'relations'>>;

const knownLink = (reg: Checked, link: unknown) => typeof link === 'string' && /^[a-z][a-z0-9_.]*$/.test(link) && (!reg.relations || reg.relations.has(link));

/** Problems with an at_most or a must_link rule: what it holds of (type), the link it counts, and nothing it cannot do. */
export function checkForms(rule: RuleDef, at: string, reg: Checked): string[] {
  const problems: string[] = [];
  if (rule.at_most !== undefined && rule.must_link !== undefined) return [`${at}: at_most and must_link are two rules`];
  const form = rule.at_most !== undefined ? 'at_most' : 'must_link';
  if (!rule.type || !reg.types.has(rule.type)) problems.push(`${at}: ${form} needs the type it holds of (type)`);
  if (rule.when !== undefined || (rule.then !== undefined && rule.then !== 'refuse')) problems.push(`${at}: ${form} refuses whatever sends the change: it takes no when, and then is refuse or left out`);
  if (rule.at_most) {
    const { link, n } = rule.at_most;
    if (!knownLink(reg, link)) problems.push(`${at}: at_most.link is a link type the packs define`);
    if (!Number.isInteger(n) || n < 1) problems.push(`${at}: at_most.n is a whole number, at least 1`);
  }
  if (rule.must_link) {
    const { link, to, from } = rule.must_link;
    if (!knownLink(reg, link)) problems.push(`${at}: must_link.link is a link type the packs define`);
    if (to !== undefined && from !== undefined) problems.push(`${at}: must_link goes to an item or comes from one, not both`);
    for (const t of [to, from]) if (t !== undefined && t !== '*' && !reg.types.has(t)) problems.push(`${at}: no type "${t}"`);
  }
  return problems;
}

/** Problems with a rule's unless: a walk the packs can take, what must hold, and a rule it can spare (hold or refuse). */
export function checkUnless(rule: RuleDef, at: string, reg: Checked): string[] {
  const u = rule.unless!;
  const problems: string[] = [];
  const walk = typeof u?.walk === 'string' ? WALK.exec(u.walk) : null;
  if (!walk || !knownLink(reg, walk[1])) problems.push(`${at}: unless.walk is a link type and its way, like "part_of<" or "depends_on>"`);
  if (u?.steps !== undefined && (!Number.isInteger(u.steps) || u.steps < 1 || u.steps > MAX_STEPS)) problems.push(`${at}: unless.steps is 1 to ${MAX_STEPS}`);
  if (u?.type !== undefined && !reg.types.has(u.type)) problems.push(`${at}: no type "${u.type}"`);
  const holds = u?.holds;
  if (!holds || typeof holds !== 'object' || (holds.status === undefined && holds.fields === undefined)) problems.push(`${at}: unless.holds says a status or fields each item reached must have`);
  else {
    if (holds.status !== undefined && !(list(holds.status) ?? []).every((s) => typeof s === 'string' && s)) problems.push(`${at}: unless.holds.status is a status, a list of them, "open" or "closed"`);
    if (holds.fields !== undefined && (typeof holds.fields !== 'object' || Array.isArray(holds.fields))) problems.push(`${at}: unless.holds.fields is { field: value }`);
  }
  if (u?.count !== undefined && !['every', 'some', 'none'].includes(u.count)) problems.push(`${at}: unless.count is every, some or none`);
  if (rule.then !== 'hold' && rule.then !== 'refuse') problems.push(`${at}: unless spares a rule that holds or refuses`);
  return problems;
}

/** An op as the forms read it: what a change sends, refs unresolved. */
export type FormOp = { op: string; ref?: string; id?: string; type?: string; title?: string; from?: string; to?: string; relation?: string; status?: string; props?: Record<string, unknown> };
type Row = { id: string; type: string; title: string; status: string; props: Record<string, unknown>; updated_at?: string; archived_at?: string | null };

/** The items the change names by id, as they are (refs made in the change are read from their create). */
async function itemsOf(q: Q, ids: string[]): Promise<Map<string, Row>> {
  if (!ids.length) return new Map();
  const { rows } = await q.query<Row>(`select id, type, title, status, props, updated_at, archived_at from entity where id = any($1::text[])`, [[...new Set(ids)]]);
  return new Map(rows.map((r) => [r.id, r]));
}

/** The type of an end of a link: a create's ref in the change, or an item by id. */
const typeOf = (ops: FormOp[], items: Map<string, Row>, end: string | undefined) => (end === undefined ? undefined : ops.find((o) => o.op === 'create' && o.ref === end)?.type ?? items.get(end)?.type);

/** A rule's say, or what it says left out, with {title} and the holder's {holder} and {heard} filled. */
const said = (rule: RuleDef, fallback: string, fill: Record<string, string>) => Object.entries(fill).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), rule.say ?? fallback);

/** What at_most refuses: a link into an item of the rule's type past n, counting what the change adds and takes away. `lifted` names a lift that spares it. */
export async function overMost(q: Q, reg: Registry, rules: RuleDef[], ops: FormOp[], lifted: (rule: RuleDef) => boolean = () => false): Promise<string[]> {
  const these = rules.filter((r) => r.at_most && r.type && !lifted(r));
  const links = ops.filter((o) => o.op === 'link' && o.to && o.type);
  if (!these.length || !links.length) return [];
  const items = await itemsOf(q, links.flatMap((o) => [o.to!, o.from ?? '']).filter(Boolean));
  const gone = new Set(ops.filter((o) => o.op === 'unlink' && o.relation).map((o) => o.relation!));
  const out: string[] = [];
  for (const rule of these) {
    const family = reg.relationFamily(rule.at_most!.link);
    const into = new Map<string, FormOp[]>();
    for (const o of links) if (family.includes(reg.canonical(o.type!)) && reg.isA(typeOf(ops, items, o.to) ?? '', rule.type!)) into.set(o.to!, [...(into.get(o.to!) ?? []), o]);
    for (const [to, adding] of into) {
      const { rows } = await q.query<{ id: string; from_id: string; title: string; type: string; status: string; updated_at: string }>(
        `select r.id, r.from_id, e.title, e.type, e.status, e.updated_at from relation r join entity e on e.id = r.from_id where r.to_id = $1 and r.type = any($2::text[]) and r.valid_to is null and e.archived_at is null limit 200`,
        [to, family],
      );
      const holding = rows.filter((r) => !gone.has(r.id) && reg.isOpen(r.type, r.status) && !adding.some((o) => o.from === r.from_id));
      if (holding.length + adding.length <= rule.at_most!.n) continue;
      const holder = holding[0];
      const title = items.get(to)?.title ?? String(ops.find((o) => o.ref === to)?.title ?? to);
      const fill = { title, holder: holder?.title ?? String(adding[0].from), heard: holder ? new Date(holder.updated_at).toISOString().slice(0, 16).replace('T', ' ') : 'in this change' };
      out.push(said(rule, `"{title}" takes at most ${rule.at_most!.n} ${rule.at_most!.link}: {holder} holds it (heard {heard})`, fill));
    }
  }
  return out;
}

/** What must_link refuses: an item of the rule's type made, or left by an unlink, without the link it must hold. */
export async function missingLinks(q: Q, reg: Registry, rules: RuleDef[], ops: FormOp[]): Promise<string[]> {
  const these = rules.filter((r) => r.must_link && r.type);
  if (!these.length) return [];
  const unlinks = ops.filter((o) => o.op === 'unlink' && o.relation).map((o) => o.relation!);
  const cut = unlinks.length ? (await q.query<{ id: string; type: string; from_id: string; to_id: string }>(`select id, type, from_id, to_id from relation where id = any($1::text[]) and valid_to is null`, [unlinks])).rows : [];
  const ends = [...ops.filter((o) => o.op === 'link').flatMap((o) => [o.from ?? '', o.to ?? '']), ...cut.flatMap((r) => [r.from_id, r.to_id])].filter(Boolean);
  const items = await itemsOf(q, ends);
  const archived = new Set(ops.filter((o) => o.op === 'archive' && o.id).map((o) => o.id!));
  const out: string[] = [];
  for (const rule of these) {
    const { link, to, from } = rule.must_link!;
    const family = reg.relationFamily(link);
    const inward = from !== undefined;
    const other = inward ? from : to;
    const fits = (t: string | undefined) => other === undefined || other === '*' || (t !== undefined && reg.isA(t, other));
    // Whether the change itself gives the item such a link.
    const given = (item: string) => ops.some((o) => o.op === 'link' && o.type && family.includes(reg.canonical(o.type)) && (inward ? o.to === item && fits(typeOf(ops, items, o.from)) : o.from === item && fits(typeOf(ops, items, o.to))));
    const needs = (title: string) => said(rule, `"{title}" needs a ${link} link${other && other !== '*' ? ` ${inward ? 'from' : 'to'} a ${other}` : ''}`, { title });
    for (const o of ops) if (o.op === 'create' && o.type && reg.isA(o.type, rule.type!) && !given(o.ref ?? '')) out.push(needs(String(o.title ?? o.type)));
    for (const r of cut) {
      if (!family.includes(r.type)) continue;
      const item = inward ? r.to_id : r.from_id;
      const held = items.get(item);
      if (!held || held.archived_at || archived.has(item) || !reg.isA(held.type, rule.type!) || !fits(items.get(inward ? r.from_id : r.to_id)?.type) || given(item)) continue;
      const { rows } = await q.query<{ id: string; type: string }>(
        `select r.id, e.type from relation r join entity e on e.id = ${inward ? 'r.from_id' : 'r.to_id'} where r.${inward ? 'to_id' : 'from_id'} = $1 and r.type = any($2::text[]) and r.valid_to is null and e.archived_at is null limit 200`,
        [item, family],
      );
      if (!rows.some((x) => !unlinks.includes(x.id) && fits(x.type))) out.push(needs(held.title));
    }
  }
  return [...new Set(out)];
}

/** Whether what a walk from `start` reaches holds as the rule's unless says, the change's own updates laid over what is stored. */
export async function holdsUnless(q: Q, reg: Registry, u: Unless, start: string | undefined, ops: FormOp[]): Promise<boolean> {
  const count = u.count ?? 'every';
  const [, link, way] = WALK.exec(u.walk)!;
  const family = reg.relationFamily(link);
  const seen = new Set<string>(start ? [start] : []);
  let front = start ? [start] : [];
  for (let step = 0; step < (u.steps ?? 1) && front.length; step++) {
    const { rows } = await q.query<{ id: string }>(
      way === '<' ? `select from_id as id from relation where to_id = any($1::text[]) and type = any($2::text[]) and valid_to is null limit 500` : `select to_id as id from relation where from_id = any($1::text[]) and type = any($2::text[]) and valid_to is null limit 500`,
      [front, family],
    );
    front = [...new Set(rows.map((r) => r.id))].filter((id) => !seen.has(id));
    for (const id of front) seen.add(id);
  }
  if (start) seen.delete(start);
  const reached = [...(await itemsOf(q, [...seen])).values()]
    .filter((r) => !r.archived_at && !ops.some((o) => o.op === 'archive' && o.id === r.id))
    .map((r) => ops.filter((o) => o.op === 'update' && o.id === r.id).reduce((x, o) => ({ ...x, status: o.status ?? x.status, props: { ...x.props, ...o.props } }), r))
    .filter((r) => !u.type || reg.isA(r.type, u.type));
  const statuses = list(u.holds.status);
  const fits = (r: Row) =>
    (!statuses || statuses.some((s) => s === r.status || (s === 'open' && reg.isOpen(r.type, r.status)) || (s === 'closed' && !reg.isOpen(r.type, r.status)))) &&
    Object.entries(u.holds.fields ?? {}).every(([f, v]) => JSON.stringify(r.props?.[f] ?? null) === JSON.stringify(v));
  return count === 'every' ? reached.every(fits) : count === 'some' ? reached.some(fits) : !reached.some(fits);
}
