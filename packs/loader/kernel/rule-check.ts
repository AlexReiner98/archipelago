// Whether a pack's rules can be enforced, checked as the pack loads: the schema half of rules (docs/kernel-packs.md,
// "Service names": the half of a closed list that checks stays with the root that loads it). The judge (src/rules.ts)
// reads the same words, which it takes from here: a comparison's form, a pattern. Which settings lift a rule is the
// rules' to name (a setting is read only as the lift of a rule): they fill the slot loader.lifts as they load.

import { checkRetention } from '../../../src/retention.ts';
import type { RuleDef } from '../../rules/kernel/rules.ts';
import type { Registry } from './packs.ts';
import { checkOnEvent } from './rule-events.ts';

type OneOrMany = string | string[];
const list = (x: OneOrMany | undefined) => (x === undefined ? undefined : Array.isArray(x) ? x : [x]);

/**
 * The slot loader.lifts (docs/kernel-packs.md, "Slots"): the settings an owner lifts a rule by, as the rules name them
 * (src/rules.ts, LIFTS), filled when the rules load, before any change is judged. Until then a rule's lifted is not
 * checked, and no setting is the rules' own.
 */
let lifts: readonly string[] | undefined;
export const fillLifts = (filled: readonly string[]): void => void (lifts = filled);
export const liftsNamed = (): readonly string[] => lifts ?? [];
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

/** Problems with a pack's rules, given the registry it loads into. Empty means they can be enforced. */
export function checkRules(rules: RuleDef[], reg: Pick<Registry, 'types'>): string[] {
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
      else for (const f of rule.unique) if (!reg.types.get(rule.type)!.fields[f]) problems.push(`${at}: ${rule.type} has no field "${f}"`);
      continue;
    }
    const then = rule.then;
    if (then !== 'hold' && then !== 'refuse' && !(typeof then === 'object' && Array.isArray(then.require))) problems.push(`${at}: then is hold, refuse or { require: [fields] }`);
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
