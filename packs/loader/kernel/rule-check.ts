// Whether a pack's rules can be enforced, checked as the pack loads: the schema half of rules (docs/kernel-packs.md,
// "Service names": the half of a closed list that checks stays with the root that loads it). The judge (packs/rules/kernel/rules.ts)
// reads the same words, which it takes from here: a comparison's form, a pattern. Which settings lift a rule is the
// rules' to name (a setting is read only as the lift of a rule): they fill the slot loader.lifts as they load.

import { checkRetention } from '../../log/kernel/retention.ts';
import type { RuleDef } from '../../rules/kernel/rules.ts';
import type { Registry } from './packs.ts';
import { checkOnEvent } from './rule-events.ts';
import { fieldsAsLaidOver } from './type-overlay.ts';

type OneOrMany = string | string[];
const list = (x: OneOrMany | undefined) => (x === undefined ? undefined : Array.isArray(x) ? x : [x]);

/**
 * The slot loader.lifts (docs/kernel-packs.md, "Slots"): the settings an owner lifts a rule by, as the rules name them
 * (packs/rules/kernel/rules.ts, LIFTS), filled when the rules load, before any change is judged. Until then a rule's lifted is not
 * checked, and no setting is the rules' own.
 */
let lifts: readonly string[] | undefined;
export const fillLifts = (filled: readonly string[]): void => void (lifts = filled);
export const liftsNamed = (): readonly string[] => lifts ?? [];
/** The slot loader.rule_forms: the rules' checks of the forms that read links (packs/rules/kernel/rule-forms.ts), filled as they load. */
type FormCheck = (rule: RuleDef, at: string, reg: Pick<Registry, 'types'> & Partial<Pick<Registry, 'relations'>>) => string[];
let forms: { checkForms: FormCheck; checkUnless: FormCheck } | undefined;
export const fillForms = (filled: NonNullable<typeof forms>): void => void (forms = filled);
/** The slot loader.rule_apart: the rules' check of apart (packs/rules/kernel/apart.ts), filled as it loads. */
let apart: FormCheck | undefined;
export const fillApart = (filled: FormCheck): void => void (apart = filled);
/** A rule's comparison: a field, an operator, and a number or a field. */
export const COMPARE = /^\s*([a-z_][a-z0-9_]*)\s*(>=|<=|!=|>|<|=)\s*(-?\d+(?:\.\d+)?|[a-z_][a-z0-9_]*)\s*$/;

/** A rule's pattern, compiled once; undefined when it is none. */
const patterns = new Map<string, RegExp | undefined>();
export function regex(pattern: string): RegExp | undefined {
  if (!patterns.has(pattern)) {
    let re: RegExp | undefined;
    try { re = new RegExp(pattern, 'u'); } catch { re = undefined; }
    patterns.set(pattern, re);
  }
  return patterns.get(pattern);
}

/**
 * Problems with a rule that carries (then.carry): it is about one or more types (when.type), each of which has the field
 * it fills; it reads by a role (as) and names the promised field it takes (read). Whether the item read promises that
 * field is known only of what is read, so it is asked as the field is filled.
 */
function checkCarry(rule: RuleDef, at: string, reg: Pick<Registry, 'types'>): string[] {
  const c = (rule.then as { carry?: { field?: unknown; as?: unknown; read?: unknown } }).carry;
  const word = (v: unknown) => typeof v === 'string' && /^[a-z][a-z0-9_]*$/.test(v);
  if (!c || !word(c.field) || !word(c.as) || !word(c.read)) return [`${at}: carry is { field, as, read }, each a field or role name`];
  const types = list(rule.when?.type) ?? [];
  if (!types.length) return [`${at}: a carry is about a type (when.type), whose field it fills`];
  const problems: string[] = [];
  for (const t of types) {
    const type = reg.types.get(t);
    if (!type) problems.push(`${at}: no type "${t}"`);
    else if (!type.fields[c.field as string]) problems.push(`${at}: ${t} has no field "${c.field}" to carry into`);
  }
  if (Object.keys(rule.when ?? {}).some((k) => k !== 'type')) problems.push(`${at}: a carry is about its type alone: it fills on every write of one`);
  return problems;
}

/** Problems with a pack's rules, given the registry it loads into. Empty means they can be enforced. */
export function checkRules(rules: RuleDef[], reg: Pick<Registry, 'types'> & Partial<Pick<Registry, 'relations'>>): string[] {
  const problems: string[] = [];
  const known = (t: string) => reg.types.has(t);
  for (const [i, rule] of rules.entries()) {
    const at = `rule ${rule.id ?? i + 1}`;
    if (rule.on !== undefined) {
      problems.push(...checkOnEvent(rule, at, known));
      continue;
    }
    if (rule.stream !== undefined || rule.keep !== undefined) {
      problems.push(...checkRetention(rule, at));
      continue;
    }
    if (rule.unique) {
      if (!rule.type || !known(rule.type)) problems.push(`${at}: unique needs a type it holds within`);
      else for (const f of rule.unique) if (!fieldsAsLaidOver(reg.types.get(rule.type)!)[f]) problems.push(`${at}: ${rule.type} has no field "${f}"`);
      continue;
    }
    if (rule.apart !== undefined) { problems.push(...(apart?.(rule, at, reg) ?? [`${at}: apart is the rules' form, not loaded`])); continue; }
    if (rule.at_most !== undefined || rule.must_link !== undefined) { problems.push(...(forms?.checkForms(rule, at, reg) ?? [`${at}: at_most and must_link are the rules' forms, not loaded`])); continue; }
    if (rule.unless !== undefined) problems.push(...(forms?.checkUnless(rule, at, reg) ?? [`${at}: unless is the rules' form, not loaded`]));
    const then = rule.then;
    if (typeof then === 'object' && then !== null && 'carry' in then) {
      problems.push(...checkCarry(rule, at, reg));
      continue;
    }
    if (then !== 'hold' && then !== 'refuse' && then !== 'spare' && !(typeof then === 'object' && Array.isArray((then as { require?: unknown }).require))) problems.push(`${at}: then is hold, refuse, spare, { require: [fields] } or { carry: { field, as, read } }`);
    // A rule spares its own pack's bookkeeping from every rule, or an op from rules of its own pack it names (spares).
    const ids = new Set(rules.map((r) => r.id).filter(Boolean));
    if (rule.spares !== undefined && (then !== 'spare' || !Array.isArray(rule.spares) || !rule.spares.length || rule.spares.some((id) => typeof id !== 'string' || id === rule.id || !ids.has(id)))) problems.push(`${at}: spares names rules of its own pack, by id, for a rule whose then is spare`);
    else if (then === 'spare' && rule.spares === undefined && rule.when?.bookkeeping !== true) problems.push(`${at}: a rule spares its own pack's bookkeeping (when.bookkeeping), or the rules of its pack it names (spares)`);
    if (then === 'spare' && rule.lifted) problems.push(`${at}: nothing lifts a rule that spares`);
    if (rule.when && 'kind' in rule.when) problems.push(`${at}: when names a type or a capability, not a kind`);
    for (const t of list(rule.when?.type) ?? []) if (!known(t)) problems.push(`${at}: no type "${t}"`);
    if (rule.when?.compare !== undefined && !COMPARE.test(rule.when.compare)) problems.push(`${at}: compare reads like "total > 500"`);
    for (const [f, pattern] of Object.entries(rule.when?.matches ?? {})) if (!pattern || !regex(pattern)) problems.push(`${at}: matches.${f} is no pattern`);
    if (rule.when?.reach !== undefined && rule.when.reach !== 'outside') problems.push(`${at}: reach is "outside", for what a pack writes outside its reach`);
    if (rule.when?.root !== undefined && (!Array.isArray(rule.when.root) || !rule.when.root.length || rule.when.root.some((f) => typeof f !== 'string'))) problems.push(`${at}: root is a list of the fields that may name a root pack`);
    if (rule.lifted !== undefined && lifts && !lifts.includes(rule.lifted)) problems.push(`${at}: lifted is one of ${lifts.join(', ')}`);
    if (rule.server && !rule.lifted) problems.push(`${at}: server says what lifts it where the workspace has not set lifted, so it needs lifted`);
  }
  return problems;
}
