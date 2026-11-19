// The genesis floor (one tier, e_k8nqby7n; this lane e_9skmrrnm): what must exist before a map, and so stays in code
// while everything else a pack declares is an item on the map. Its rules are the owner's protecting ones: a change to a
// floor rule's item may tighten it and never loosen it, a loosening is refused whoever sends it, and the floor itself
// changes only in code. What a setting lifts (a rule's `lifted`) it still lifts, as it does today: that is the owner's
// lever, not an edit of the rule. Rules decide here as data (packs/rules/pack.json: floor, rule_items); this module only
// reads what an op does to a rule item, as facts the judge's `applies` reads (./rules.ts).

import type { Registry } from '../../loader/kernel/packs.ts';
import type { RuleDef, Target, Written } from './rules.ts';

/**
 * The packs whose declarations exist before any map: core alone. Its item head (packs/loader/kernel/head.ts) and its part
 * types (pack, type, link type, rule, view...: packs/pack_model/README.md) are what every other declaration is an item
 * of, so they cannot be items first. pack_model is not on the floor: it is words only (requires, flavour_of,
 * stands_over), each drawn from a field that stays the truth, and nothing here reads its links.
 */
export const FLOOR_PACKS = ['core'] as const;

/**
 * Core's rules on the floor, each with why: every rule of core's that judges (hold, refuse, spare). Each keeps a person
 * in control of something an agent, a pack or a drawing could otherwise do unseen; test/floor.test.ts fails when core
 * gains a judging rule that is not named here, so a new one is placed on the floor, or off it, on purpose.
 */
export const FLOOR: Readonly<Record<string, string>> = {
  agent_changes: "an agent's change waits for the owner: the rule that holds agents",
  settle: 'settling a decision or question is the owner\'s',
  forget: 'a forget destroys an item\'s key for good',
  code_runs: 'code an agent writes runs for everyone who opens it',
  public: 'what is public reaches anyone',
  asked: 'a change that asks to wait waits',
  propose_only: 'a token that may only propose never applies',
  pack_code: "a pack's code is code that runs",
  agent_pack_code: "a pack's code set by an agent is code that runs",
  agent_pack_set: "a pack turned on is the owner's",
  agent_packs: "a pack's item is the owner's to change",
  part_trial: 'a trial of a part stays on its island: a spare, so it may only narrow',
  version_spread: 'code spread to another island is the owner\'s',
  agent_island_pack: "what an island runs is the owner's",
  agent_island_code: "what code an island runs is the owner's",
  island_full: "an island's cap is the owner's look",
  root: 'a root pack is never written over',
  root_off: 'a root pack is never turned off',
  pack_reach: 'a pack writes only within its reach',
  drawing_reach: "a drawing writes only what its style declares, as the person",
  drawing_code: 'a drawing never writes code as the person',
  drawing_public: 'a drawing never makes anything public as the person',
  screens_human: 'a screen is the owner\'s to change',
  styles_merge: 'merging styles or layouts merges code',
  people_merge: 'merging people merges who someone is',
  dormant: "writing to a type whose pack is gone waits",
  agent_publish: 'publishing is the owner\'s',
  agent_unpublish: 'unpublishing is the owner\'s',
  agent_backups: 'a backup holds the whole map',
  agent_automations: 'an automation acts unattended',
  agent_harness_settings: "an agent writes no harness file but the owner's two",
};

/** The capability a type declares when its items are rules the judge reads: core's rule type (packs/pack_model/README.md), so the kernel names no type. */
export const RULE_CAPABILITY = 'judges';

/** Whether this rule is on the floor. */
export const onFloor = (pack: unknown, id: unknown): boolean => pack === 'core' && typeof id === 'string' && Object.hasOwn(FLOOR, id);

/** Core's floor rules as a manifest declares them, for a registry that loads the floor from code (lane 2). */
export const floorRules = (core: { rules?: RuleDef[] }): (RuleDef & { pack: string })[] =>
  (core.rules ?? []).filter((r) => onFloor('core', r.id)).map((r) => ({ ...r, pack: 'core' }));

/**
 * The rule an item holds, from its fields (packs/pack_model/README.md): its id is declares (an owner's version: the
 * preset it stands over), its pack shipped.pack, its definition spec. An owner's version of a floor rule is core's.
 * The older shape (pack, rule, def) is read too.
 */
export function ruleOf(props: Record<string, unknown> | undefined): (RuleDef & { pack?: string }) | undefined {
  if (!props) return undefined;
  const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined);
  const def = (obj(props.spec) ?? obj(props.def) ?? props) as RuleDef & Record<string, unknown>;
  const id = (props.declares ?? props.preset ?? props.rule ?? def.id) as string | undefined;
  const pack = (obj(props.shipped)?.pack ?? props.pack ?? def.pack ?? (props.preset !== undefined && onFloor('core', id) ? 'core' : undefined)) as string | undefined;
  return { ...def, id, pack };
}

type OneOrMany = string | string[] | undefined;
const set = (x: OneOrMany) => new Set(x === undefined ? [] : Array.isArray(x) ? x : [x]);
const within = (a: OneOrMany, b: OneOrMany) => [...set(a)].every((v) => set(b).has(v));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** How strong what a rule does is: a spare lets through, ask asks, require needs fields, hold waits, refuse stops. */
const strength = (then: RuleDef['then']): number =>
  then === 'refuse' ? 4 : then === 'hold' ? 3 : typeof then === 'object' && then && 'require' in then ? 2 : then === 'ask' ? 1 : then === 'spare' ? -1 : 0;

/** A when's word or list of words (its op, type, visibility, fields, root...): any of them matches, so more match more. */
const words = (v: unknown): v is OneOrMany => typeof v === 'string' || (Array.isArray(v) && v.every((x) => typeof x === 'string'));

/** What in `next`'s when matches less than `old`'s did ("" where it matches at least as much). */
function narrows(old: NonNullable<RuleDef['when']>, next: NonNullable<RuleDef['when']>): string {
  for (const [k, v] of Object.entries(next) as [string, unknown][]) {
    const was = (old as Record<string, unknown>)[k];
    if (was === undefined) return `it adds when.${k}`;
    if (words(was) && words(v) ? !within(was, v) : k === 'status' ? !statusCovers(was as Status, v as Status) : !same(was, v)) return `it narrows when.${k}`;
  }
  return '';
}
type Status = { from?: OneOrMany; to?: OneOrMany };
const statusCovers = (old: Status, next: Status) => (['from', 'to'] as const).every((e) => next[e] === undefined || (old[e] !== undefined && within(old[e], next[e])));

/** Whether a hold is under readings, as the judge reads it. */
const readings = (r: RuleDef) => r.readings ?? r.then !== 'hold';

/**
 * Why `next` loosens `old`, or "" where it does not: it matches no less, does no less, is lifted by nothing new and
 * spares nothing new. A spare loosens by nature, so for one the test runs the other way: it may only narrow.
 */
export function loosens(old: RuleDef & { pack?: string }, next: (RuleDef & { pack?: string }) | undefined): string {
  if (!next) return 'it retires the rule';
  if (next.pack !== old.pack || next.id !== old.id) return 'it renames the rule, which retires it';
  if (old.then === 'spare') {
    if (next.then !== 'spare') return '';
    const widened = narrows(next.when ?? {}, old.when ?? {});
    if (widened) return `the spare matches more (${widened.replace('adds', 'drops').replace('narrows', 'widens')})`;
    if (old.spares && !(next.spares && within(next.spares, old.spares))) return 'the spare spares more';
    return '';
  }
  if (strength(next.then) < strength(old.then)) return `it does less (${String(JSON.stringify(old.then))} to ${String(JSON.stringify(next.then))})`;
  const req = (r: RuleDef) => (typeof r.then === 'object' && r.then && 'require' in r.then ? r.then.require : undefined);
  if (req(old) && req(next) && !within(req(old), req(next))) return 'it requires fewer fields';
  const narrowed = narrows(old.when ?? {}, next.when ?? {});
  if (narrowed) return narrowed;
  if (next.lifted !== undefined && next.lifted !== old.lifted) return `it is lifted by ${next.lifted}`;
  if (next.server && !old.server) return "the server's policy may lift it";
  if (readings(old) && !readings(next)) return 'readings escape it';
  if (next.unless !== undefined && !same(next.unless, old.unless)) return 'it is spared by an unless';
  if (next.on !== old.on) return 'it judges another event';
  return '';
}

/** What an op does to rule items, as the judge reads it. */
export interface FloorFacts {
  /** It writes an item that holds a rule. */
  rule_item?: boolean;
  /** It loosens a floor rule, and how. */
  loosens?: string;
}

const isRule = (reg: Registry, type: string | undefined) => Boolean(type && (reg.types.get(type)?.capabilities as Record<string, unknown> | undefined)?.[RULE_CAPABILITY] !== undefined);

/**
 * A new or changed rule loosens the floor where it takes a floor rule's name but does less than the floor's own, as code
 * declares it (the registry's: a map's first floor items, made as it begins, match it and pass), or where it spares one.
 */
function claims(reg: Registry, rule: (RuleDef & { pack?: string }) | undefined): string {
  if (!rule) return '';
  if (onFloor(rule.pack, rule.id)) {
    const code = reg.rules.find((r) => r.pack === 'core' && r.id === rule.id);
    const why = code ? loosens(code, rule) : 'the floor rule is not in code here';
    return why && `it overrides a floor rule: ${why}`;
  }
  if (rule.then === 'spare' && (!rule.spares || (rule.pack === 'core' && rule.spares.some((s) => onFloor('core', s))))) return 'it spares floor rules';
  return '';
}

/** The ops that take an item away: on a floor rule, each retires it. */
const RETIRES = new Set(['archive', 'forget', 'merge']);

/** The facts of one op on rule items: `targets` are the items it writes, as they are before it. */
export function floorFacts(reg: Registry, w: Written & { title?: string }, targets: Target[]): FloorFacts {
  const writes = (w.op === 'create' && isRule(reg, w.type)) || targets.some((t) => isRule(reg, t.type));
  if (!writes) return {};
  if (w.op === 'create') { const why = claims(reg, ruleOf(w.props)); return { rule_item: true, ...(why && { loosens: why }) }; }
  for (const t of targets.filter((x) => isRule(reg, x.type))) {
    const was = ruleOf(t.props)!;
    const floor = onFloor(was.pack, was.id);
    if (!floor) {
      if (w.op !== 'update') continue;
      const why = claims(reg, ruleOf({ ...t.props, ...w.props }));
      if (why) return { rule_item: true, loosens: why };
      continue;
    }
    if (w.op === 'update') {
      if (w.status !== undefined && w.status !== t.status) return { rule_item: true, loosens: 'it changes the rule\'s status' };
      const why = loosens(was, ruleOf({ ...t.props, ...w.props }));
      if (why) return { rule_item: true, loosens: why };
    } else if (RETIRES.has(w.op)) return { rule_item: true, loosens: w.op === 'merge' ? 'it merges the rule away' : 'it retires the rule' };
  }
  return { rule_item: true };
}
