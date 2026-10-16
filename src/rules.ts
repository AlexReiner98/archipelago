// Rules: what tightens writes, declared as data in pack files and enforced on what is written, whichever way it
// came (an agent's change, a pack's action, the page). A rule only tightens: it holds a change for a person,
// refuses it, or requires fields. Rules from several packs compose in any order, and removing one can only loosen
// what it added. The kernel's own (which writes wait for a person) ship in the core pack in this same form.

import type { Q } from './db.ts';
import type { Registry } from './packs.ts';

type OneOrMany = string | string[];

export interface RuleDef {
  /** A name for it, used in what a refusal says. */
  id?: string;
  when?: {
    /** Who makes the change: an agent (any actor not a person) or a human. */
    actor?: 'agent' | 'human';
    op?: OneOrMany;
    /** What it is written to, flavours included. A merge is matched by either item. */
    type?: OneOrMany;
    kind?: OneOrMany;
    /** Fields the change sets, whatever to. */
    fields?: string[];
    /** A change of status: from what it is, to what it becomes. "open" and "closed" stand for any such status. */
    status?: { from?: OneOrMany; to?: OneOrMany };
    visibility?: OneOrMany;
    /** A field against a number or another field, as the item will be: "total > 500", "paid < total". */
    compare?: string;
  };
  then?: 'hold' | 'refuse' | { require: string[] };
  /** Fields whose values together may belong to one item of the type only. */
  unique?: string[];
  /** For unique: the type it holds within, flavours included. */
  type?: string;
  /** What a refusal says. {title} is the item's. */
  say?: string;
}

/** An item a change is written to, as it is before the change. */
export interface Target {
  id: string;
  type: string;
  title: string;
  status: string;
  props: Record<string, unknown>;
}

/** The part of an op a rule reads. */
export interface Written {
  op: string;
  type?: string;
  status?: string;
  visibility?: string;
  props?: Record<string, unknown>;
}

const list = (x: OneOrMany | undefined) => (x === undefined ? undefined : Array.isArray(x) ? x : [x]);
const COMPARE = /^\s*([a-z_][a-z0-9_]*)\s*(>=|<=|!=|>|<|=)\s*(-?\d+(?:\.\d+)?|[a-z_][a-z0-9_]*)\s*$/;

/** Problems with a pack's rules, given the registry it loads into. Empty means they can be enforced. */
export function checkRules(rules: RuleDef[], reg: Pick<Registry, 'types'>): string[] {
  const problems: string[] = [];
  const known = (t: string) => reg.types.has(t);
  for (const [i, rule] of rules.entries()) {
    const at = `rule ${rule.id ?? i + 1}`;
    if (rule.unique) {
      if (!rule.type || !known(rule.type)) problems.push(`${at}: unique needs a type it holds within`);
      else for (const f of rule.unique) if (!reg.types.get(rule.type)!.fields[f]) problems.push(`${at}: ${rule.type} has no field "${f}"`);
      continue;
    }
    const then = rule.then;
    if (then !== 'hold' && then !== 'refuse' && !(then && Array.isArray(then.require))) problems.push(`${at}: then is hold, refuse or { require: [fields] }`);
    for (const t of [...(list(rule.when?.type) ?? []), ...(list(rule.when?.kind) ?? [])]) if (!known(t)) problems.push(`${at}: no type "${t}"`);
    if (rule.when?.compare !== undefined && !COMPARE.test(rule.when.compare)) problems.push(`${at}: compare reads like "total > 500"`);
  }
  return problems;
}

/** Whether a rule's when holds for one op written by this actor to these targets (none for a create). */
function applies(rule: RuleDef, reg: Registry, human: boolean, w: Written, targets: Target[]): boolean {
  const when = rule.when ?? {};
  if (when.actor && (when.actor === 'human') !== human) return false;
  if (when.op && !list(when.op)!.includes(w.op)) return false;
  const types = w.op === 'create' && w.type ? [w.type] : targets.map((t) => t.type);
  const of = (wanted: string[] | undefined) => !wanted || types.some((t) => wanted.some((x) => reg.isA(t, x)));
  if (!of(list(when.type)) || !of(list(when.kind))) return false;
  if (when.fields && !when.fields.some((f) => w.props && f in w.props)) return false;
  if (when.visibility && !(w.visibility && list(when.visibility)!.includes(w.visibility))) return false;
  const target = targets[0];
  if (when.status) {
    if (!target || w.status === undefined || w.status === target.status) return false;
    const fits = (wanted: string[] | undefined, status: string) =>
      !wanted || wanted.some((s) => s === status || (s === 'open' && reg.isOpen(target.type, status)) || (s === 'closed' && !reg.isOpen(target.type, status)));
    if (!fits(list(when.status.from), target.status) || !fits(list(when.status.to), w.status)) return false;
  }
  if (when.compare) {
    const [, field, op, right] = COMPARE.exec(when.compare)!;
    const props = { ...target?.props, ...w.props };
    const a = Number(props[field]);
    const b = /^-?\d/.test(right) ? Number(right) : Number(props[right]);
    if (props[field] == null || Number.isNaN(a) || Number.isNaN(b)) return false;
    if (!{ '>': a > b, '>=': a >= b, '<': a < b, '<=': a <= b, '=': a === b, '!=': a !== b }[op]) return false;
  }
  return true;
}

/** What the rules make of one op: whether it waits for a person, and what refuses it. */
export function judge(reg: Registry, human: boolean, w: Written, targets: Target[]): { hold: boolean; refused: string[] } {
  let hold = false;
  const refused: string[] = [];
  const title = targets[0]?.title ?? String((w as { title?: string }).title ?? '');
  const said = (rule: RuleDef, fallback: string) => (rule.say ?? fallback).replaceAll('{title}', title);
  for (const rule of reg.rules) {
    if (rule.unique || !applies(rule, reg, human, w, targets)) continue;
    if (rule.then === 'hold') hold = hold || !human;
    else if (rule.then === 'refuse') refused.push(said(rule, `"${title}": refused by ${rule.pack}'s rule${rule.id ? ` ${rule.id}` : ''}`));
    else if (rule.then) {
      const props = { ...targets[0]?.props, ...w.props };
      const missing = rule.then.require.filter((f) => props[f] == null || props[f] === '');
      if (missing.length) refused.push(said(rule, `"${title}": needs ${missing.join(', ')}`));
    }
  }
  return { hold, refused };
}

/** What a unique rule refuses: another item of the type with the same values. `self` is the item being changed. */
export async function clashes(q: Q, reg: Registry, w: Written, target: Target | undefined): Promise<string[]> {
  const type = w.op === 'create' ? w.type : target?.type;
  if (!type || (w.op !== 'create' && w.op !== 'update')) return [];
  const out: string[] = [];
  for (const rule of reg.rules) {
    if (!rule.unique || !rule.type || !reg.isA(type, rule.type) || !rule.unique.some((f) => w.props && f in w.props)) continue;
    const props = { ...target?.props, ...w.props };
    if (rule.unique.some((f) => props[f] == null)) continue;
    const { rows } = await q.query<{ id: string; title: string }>(
      `select id, title from entity where type = any($1::text[]) and archived_at is null and id <> $2 and props @> $3::jsonb limit 1`,
      [reg.family(rule.type), target?.id ?? '', JSON.stringify(Object.fromEntries(rule.unique.map((f) => [f, props[f]])))],
    );
    const values = rule.unique.map((f) => `${f} ${JSON.stringify(props[f])}`).join(', ');
    if (rows.length) out.push((rule.say ?? `"${rows[0].title}" (${rows[0].id}) already has ${values}`).replaceAll('{title}', rows[0].title));
  }
  return out;
}
