// The rule forms that read links (the build round, feature e_jmxzebgh): at most n links into an item (at_most), an
// item that must hold a link (must_link), and a rule that applies unless what a walk from the item reaches holds
// (unless). Each is data in a pack's rules (RuleDef, ./rules.ts), checked as the pack loads (checkForms, checkUnless,
// called by packs/loader/kernel/rule-check.ts) and judged in decide: at_most and must_link refuse whatever sends the
// change, as unique does; unless spares a hold or a refusal its condition meets (./rules.ts, judge).

import type { Q } from '../../database/kernel/db.ts';
import type { Registry } from '../../loader/kernel/packs.ts';
import type { RuleDef } from './rules.ts';
import { checkLinkSpec, checkScope, inScope, islandOf, linksHeld, named, type LinkSpec, type Scope } from './rule-links.ts';

type OneOrMany = string | string[];
const list = (x: OneOrMany | undefined) => (x === undefined ? undefined : Array.isArray(x) ? x : [x]);

/** At most n open links of a type (flavours included) into an item of the rule's type; a link from a closed or archived item holds nothing. */
export interface AtMost { link: string; n: number }
/**
 * An item of the rule's type holds a link of a type: out to an item of `to`, or in from an item of `from` ("*" for any),
 * at least n of them (1 left out). Neither: out, to anything. With `on`, only an item on an island in that scope is held to it.
 */
export interface MustLink extends LinkSpec { on?: Scope }
/** What a walk from the item reaches, and what must hold of it: `every` (the default) item, `some`, or `none`. */
export interface Unless {
  /** A link type and its way: "part_of<" the items linked into it, "depends_on>" (or bare) the items it links to. */
  walk: string;
  /** How many links deep, 1 to 5; 1 left out. */
  steps?: number;
  /** Only the items of this type (flavours included) count. */
  type?: string;
  /** What each item reached must have: a status, fields, a link it holds (as must_link's, at least n), or more than one. */
  holds: { status?: OneOrMany; fields?: Record<string, unknown>; link?: LinkSpec };
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
    problems.push(...checkLinkSpec(rule.must_link, `${at}: must_link`, reg));
    if (rule.must_link.on !== undefined) problems.push(...checkScope(rule.must_link.on, `${at}: must_link.on`, reg));
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
  if (!holds || typeof holds !== 'object' || (holds.status === undefined && holds.fields === undefined && holds.link === undefined)) problems.push(`${at}: unless.holds says a status, fields or a link each item reached must have`);
  else {
    if (holds.status !== undefined && !(list(holds.status) ?? []).every((s) => typeof s === 'string' && s)) problems.push(`${at}: unless.holds.status is a status, a list of them, "open" or "closed"`);
    if (holds.fields !== undefined && (typeof holds.fields !== 'object' || Array.isArray(holds.fields))) problems.push(`${at}: unless.holds.fields is { field: value }`);
    if (holds.link !== undefined) problems.push(...checkLinkSpec(holds.link, `${at}: unless.holds.link`, reg));
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

/**
 * What must_link refuses: an item of the rule's type made, or left by an unlink, holding fewer links of the kind than it
 * must (n, 1 left out), on an island in the rule's scope (on) where it names one. {missing} in its say is the item's title.
 */
export async function missingLinks(q: Q, reg: Registry, rules: RuleDef[], ops: FormOp[]): Promise<string[]> {
  const these = rules.filter((r) => r.must_link && r.type);
  if (!these.length) return [];
  const unlinks = ops.filter((o) => o.op === 'unlink' && o.relation).map((o) => o.relation!);
  const cut = unlinks.length ? (await q.query<{ id: string; type: string; from_id: string; to_id: string }>(`select id, type, from_id, to_id from relation where id = any($1::text[]) and valid_to is null`, [unlinks])).rows : [];
  const items = await itemsOf(q, cut.flatMap((r) => [r.from_id, r.to_id]));
  const archived = new Set(ops.filter((o) => o.op === 'archive' && o.id).map((o) => o.id!));
  const out: string[] = [];
  for (const rule of these) {
    const spec = rule.must_link!;
    const { link, to, from } = spec;
    const n = spec.n ?? 1;
    const family = reg.relationFamily(link);
    const inward = from !== undefined;
    const other = inward ? from : to;
    const needs = (title: string) => said(rule, `"{title}" needs ${n > 1 ? `${n} ${link} links` : `a ${link} link`}${other && other !== '*' ? ` ${inward ? 'from' : 'to'} a ${other}` : ''}`, { title, missing: `"${title}"` });
    // The items to judge: each one made of the rule's type, and each one of it an unlink in the change leaves.
    const judged = new Map<string, { title: string; props?: Record<string, unknown> }>();
    for (const [i, o] of ops.entries()) if (o.op === 'create' && o.type && reg.isA(o.type, rule.type!)) judged.set(o.ref ?? `#${i}`, { title: String(o.title ?? o.type), props: o.props });
    for (const r of cut) {
      const item = inward ? r.to_id : r.from_id;
      const held = items.get(item), far = items.get(inward ? r.from_id : r.to_id)?.type;
      // Only a cut of a link the rule counts leaves an item short: one made before the rule is not judged by another link.
      const counted = other === undefined || other === '*' || (far !== undefined && reg.isA(far, other));
      if (counted && family.includes(r.type) && held && !held.archived_at && !archived.has(item) && reg.isA(held.type, rule.type!)) judged.set(item, { title: held.title, props: held.props });
    }
    for (const [item, { title, props }] of judged) {
      if (spec.on && !(await inScope(q, reg, spec.on, islandOf(ops, item, props), ops))) continue;
      if ((await linksHeld(q, reg, item, spec, ops)) < n) out.push(needs(title));
    }
  }
  return [...new Set(out)];
}

/** The items a change makes, by ref, as the rules read them before it is written: a made-up item in a rule's example is one. */
export function madeIn(reg: Pick<Registry, 'types'>, ops: FormOp[]): Map<string, Row> {
  return new Map(ops.flatMap((o) => (o.op === 'create' && o.ref && o.type ? [[o.ref, { id: o.ref, type: o.type, title: String(o.title ?? o.type), status: o.status ?? reg.types.get(o.type)?.statuses.open[0] ?? '', props: o.props ?? {} }] as const] : [])));
}

/**
 * Whether what a walk from `start` reaches holds as the rule's unless says, the change's own items, links, cuts and
 * updates laid over what is stored; and where it does not, what fails it ({missing} in the rule's say), each by its
 * title and status, so a verdict titled as its screen is told from it: with every, the items that do not hold; with
 * none, those that do.
 */
export async function holdsUnless(q: Q, reg: Registry, u: Unless, start: string | undefined, ops: FormOp[]): Promise<{ holds: boolean; missing: string }> {
  const count = u.count ?? 'every';
  const [, link, way] = WALK.exec(u.walk)!;
  const family = reg.relationFamily(link);
  const gone = new Set(ops.filter((o) => o.op === 'unlink' && o.relation).map((o) => o.relation!));
  const given = ops.filter((o) => o.op === 'link' && o.type && o.from && o.to && family.includes(reg.canonical(o.type)));
  const seen = new Set<string>(start ? [start] : []);
  let front = start ? [start] : [];
  for (let step = 0; step < (u.steps ?? 1) && front.length; step++) {
    const { rows } = await q.query<{ rel: string; id: string }>(
      way === '<' ? `select id as rel, from_id as id from relation where to_id = any($1::text[]) and type = any($2::text[]) and valid_to is null limit 500` : `select id as rel, to_id as id from relation where from_id = any($1::text[]) and type = any($2::text[]) and valid_to is null limit 500`,
      [front, family],
    );
    const added = given.filter((o) => front.includes(way === '<' ? o.to! : o.from!)).map((o) => (way === '<' ? o.from! : o.to!));
    front = [...new Set([...rows.filter((r) => !gone.has(r.rel)).map((r) => r.id), ...added])].filter((id) => !seen.has(id));
    for (const id of front) seen.add(id);
  }
  if (start) seen.delete(start);
  const made = madeIn(reg, ops);
  const reached = [...(await itemsOf(q, [...seen].filter((id) => !made.has(id)))).values(), ...[...seen].flatMap((id) => made.get(id) ?? [])]
    .filter((r) => !r.archived_at && !ops.some((o) => o.op === 'archive' && o.id === r.id))
    .map((r) => ops.filter((o) => o.op === 'update' && o.id === r.id).reduce((x, o) => ({ ...x, status: o.status ?? x.status, props: { ...x.props, ...o.props } }), r))
    .filter((r) => !u.type || reg.isA(r.type, u.type));
  const statuses = list(u.holds.status);
  const has = u.holds.link;
  const fit = new Map<string, boolean>();
  for (const r of reached) {
    fit.set(r.id,
      (!statuses || statuses.some((s) => s === r.status || (s === 'open' && reg.isOpen(r.type, r.status)) || (s === 'closed' && !reg.isOpen(r.type, r.status)))) &&
      Object.entries(u.holds.fields ?? {}).every(([f, v]) => JSON.stringify(r.props?.[f] ?? null) === JSON.stringify(v)) &&
      (!has || (await linksHeld(q, reg, r.id, has, ops)) >= (has.n ?? 1)));
  }
  const failing = reached.filter((r) => (count === 'none' ? fit.get(r.id) : !fit.get(r.id)));
  const holds = count === 'some' ? reached.some((r) => fit.get(r.id)) : !failing.length;
  return { holds, missing: holds || count === 'some' ? '' : named(failing.map((r) => r.title), failing.map((r) => r.status)) };
}
