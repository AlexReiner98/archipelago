// What the rule forms read of an item's links and of the island it stands on (round three, feature e_kc462x95): how
// many links of a kind it holds once the change is applied (must_link with n, unless with holds.link), whether its island
// speaks a pack or is a focus of a type (must_link with on), and how a refusal names what failed it ({missing}).
// Kept apart from ./rule-forms.ts so each file stays one thing.

import type { Q } from '../../database/kernel/db.ts';
import { ISLAND } from '../../loader/kernel/island-items.ts';
import type { Registry } from '../../loader/kernel/packs.ts';
import type { FormOp } from './rule-forms.ts';

/** A link an item holds: out to an item of `to`, or in from an item of `from` ("*" for any), at least n of them (1 left out). */
export interface LinkSpec { link: string; to?: string; from?: string; n?: number }
/** The islands a rule holds on: those that speak a pack, or are a focus of a type (flavours included), or both. */
export interface Scope { pack?: string; focus?: string }

type Reg = Pick<Registry, 'types'> & Partial<Pick<Registry, 'relations'>>;
const knownLink = (reg: Reg, link: unknown) => typeof link === 'string' && /^[a-z][a-z0-9_.]*$/.test(link) && (!reg.relations || reg.relations.has(link));

/** Problems with a link an item must hold, at `at` (must_link, or unless.holds.link). */
export function checkLinkSpec(spec: LinkSpec, at: string, reg: Reg): string[] {
  const problems: string[] = [];
  if (!knownLink(reg, spec?.link)) problems.push(`${at}.link is a link type the packs define`);
  if (spec?.to !== undefined && spec?.from !== undefined) problems.push(`${at} goes to an item or comes from one, not both`);
  for (const t of [spec?.to, spec?.from]) if (t !== undefined && t !== '*' && !reg.types.has(t)) problems.push(`${at}: no type "${t}"`);
  if (spec?.n !== undefined && (!Number.isInteger(spec.n) || spec.n < 1)) problems.push(`${at}.n is a whole number, at least 1`);
  return problems;
}

/** Problems with a rule's scope (must_link.on). */
export function checkScope(on: Scope, at: string, reg: Reg): string[] {
  if (!on || typeof on !== 'object' || (on.pack === undefined && on.focus === undefined)) return [`${at} is { pack } or { focus }: the islands it holds on`];
  const problems: string[] = [];
  if (on.pack !== undefined && (typeof on.pack !== 'string' || !/^[a-z][a-z0-9_.-]*$/.test(on.pack))) problems.push(`${at}.pack is a pack's id`);
  if (on.focus !== undefined && !reg.types.has(on.focus)) problems.push(`${at}.focus: no type "${on.focus}"`);
  return problems;
}

type Row = { id: string; type: string; props: Record<string, unknown> };
const bare = (key: string) => key.replace(/^\{(.*)\}$/, '$1');

/** The island an item stands on as the change leaves it: a create's, a move's, or what is stored. */
export function islandOf(ops: FormOp[], item: string, stored?: Record<string, unknown>): string | undefined {
  const moved = [...ops].reverse().find((o) => o.op === 'update' && o.id === item && o.props?.island !== undefined);
  const made = ops.find((o) => o.op === 'create' && o.ref === item);
  const island = moved?.props?.island ?? made?.props?.island ?? stored?.island;
  return typeof island === 'string' && island ? bare(island) : undefined;
}

/** Whether an island (by id, or the ref this change makes it under) is in a rule's scope. */
export async function inScope(q: Q, reg: Registry, on: Scope, island: string | undefined, ops: FormOp[]): Promise<boolean> {
  if (!island) return false;
  const made = ops.find((o) => o.op === 'create' && o.ref === island);
  const it: Row | undefined = made ? { id: island, type: made.type ?? '', props: made.props ?? {} } : (await q.query<Row>(`select id, type, props from entity where id = $1 and archived_at is null`, [island])).rows[0];
  if (!it) return false;
  const focus = it.props?.focus === true;
  const pack = focus ? reg.type(it.type)?.pack : reg.isA(it.type, ISLAND) ? String(it.props?.pack ?? '') : undefined;
  return (on.pack === undefined || on.pack === pack) && (on.focus === undefined || (focus && reg.isA(it.type, on.focus)));
}

/**
 * How many items an item holds a link of the spec's kind with, as the change leaves it: what is stored and not cut or
 * archived by it, and what it adds. `item` may be a ref the change makes. Each other end counts once.
 */
export async function linksHeld(q: Q, reg: Registry, item: string, spec: LinkSpec, ops: FormOp[]): Promise<number> {
  const family = reg.relationFamily(spec.link);
  const inward = spec.from !== undefined;
  const other = inward ? spec.from : spec.to;
  const fits = (t: string | undefined) => other === undefined || other === '*' || (t !== undefined && reg.isA(t, other));
  const gone = new Set(ops.filter((o) => o.op === 'unlink' && o.relation).map((o) => o.relation!));
  const archived = new Set(ops.filter((o) => o.op === 'archive' && o.id).map((o) => o.id!));
  const { rows } = await q.query<{ id: string; end_id: string; type: string }>(
    `select r.id, e.id as end_id, e.type from relation r join entity e on e.id = r.${inward ? 'from_id' : 'to_id'} where r.${inward ? 'to_id' : 'from_id'} = $1 and r.type = any($2::text[]) and r.valid_to is null and e.archived_at is null limit 200`,
    [item, family],
  );
  const ends = new Set(rows.filter((r) => !gone.has(r.id) && !archived.has(r.end_id) && fits(r.type)).map((r) => r.end_id));
  const given = ops.filter((o) => o.op === 'link' && o.type && family.includes(reg.canonical(o.type)) && (inward ? o.to === item : o.from === item));
  const far = given.map((o) => (inward ? o.from : o.to)).filter((x): x is string => Boolean(x) && !archived.has(x!));
  const stored = far.length ? new Map((await q.query<{ id: string; type: string }>(`select id, type from entity where id = any($1::text[]) and archived_at is null`, [far])).rows.map((r) => [r.id, r.type])) : new Map<string, string>();
  for (const end of far) if (fits(ops.find((o) => o.op === 'create' && o.ref === end)?.type ?? stored.get(end))) ends.add(end);
  return ends.size;
}

/** How a refusal names what failed it ({missing}): each title quoted, five at most and how many more. */
export const named = (titles: string[]) => (titles.length > 5 ? [...titles.slice(0, 5).map((t) => `"${t}"`), `${titles.length - 5} more`] : titles.map((t) => `"${t}"`)).join(', ');
