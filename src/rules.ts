// Rules: what decides a write, declared as data in pack files and enforced on what is written, whichever way it came
// (an agent's change, a pack's action, the page). A rule only tightens: it holds a change for a person, refuses it,
// or requires fields. Rules from several packs compose in any order, and removing one can only loosen what it added.
// Whether a change applies, waits or is refused is decided here and nowhere else: the kernel's own rules (an agent's
// change waits, settling a question is the owner's, code that runs, publishing, backups) ship in the core pack in this
// same form, and a setting only lifts a rule its pack declared liftable (`lifted`). `decide` answers for a change,
// naming the rule that decided it; `mayDo` for an act that is not a change (publishing, downloading a backup).

import type { Q } from './db.ts';
import type { Registry } from './packs.ts';
import { checkRetention, type Keep } from './retention.ts';
import { fieldInReach, inReach } from './reach.ts';
import { checkReplyRule, onReply } from './reply-rules.ts';

type OneOrMany = string | string[];

export type Level = 'auto' | 'propose' | 'forbidden';
export type OpKind = 'create' | 'update' | 'link' | 'unlink' | 'archive' | 'restore' | 'merge' | 'define_type';
/** The server's word on agents' changes, per op (pelago.config.json): auto lifts the rule a workspace that has not chosen is under, forbidden refuses. */
export type Policy = Record<OpKind, Level>;

/** As shipped, the server lifts nothing: a workspace that never chose keeps waiting for a person. A new one chooses as it begins (beginApplying). */
export const DEFAULT_AGENT_POLICY: Policy = {
  create: 'propose',
  update: 'propose',
  link: 'propose',
  unlink: 'propose',
  archive: 'propose',
  restore: 'propose',
  merge: 'propose',
  define_type: 'propose',
};

export interface RuleDef {
  /** A name for it, used in what a refusal says and in what a held change is held by. */
  id?: string;
  /** The event it decides about when that is not a change: "reply_ended", a session's reply ending (src/replies.ts). */
  on?: string;
  when?: {
    /** Who makes the change: an agent (any actor not a person) or a human. */
    actor?: 'agent' | 'human';
    /** The op, or an act that is not a change (publish, backup_download). */
    op?: OneOrMany;
    /** What it is written to, flavours included. A merge is matched by either item. */
    type?: OneOrMany;
    kind?: OneOrMany;
    /** A capability the type has, by name, or with what it must declare: { "settles": { "by": "word" } }. */
    capability?: string | Record<string, Record<string, unknown>>;
    /** Fields the change sets, whatever to. */
    fields?: string[];
    /** A change of status: from what it is, to what it becomes. "open" and "closed" stand for any such status. */
    status?: { from?: OneOrMany; to?: OneOrMany };
    visibility?: OneOrMany;
    /** A field against a number or another field, as the item will be: "total > 500", "paid < total". */
    compare?: string;
    /** Written to a type or link type whose pack is gone. */
    dormant?: boolean;
    /** The change asks to wait for a person. */
    asked?: boolean;
    /** What the agent's token may do: "propose" for one whose every change waits. */
    may?: string;
    /** Whether the change says on whose authority it is made. */
    said?: boolean;
    /** Whether a rule holds this op: false for what is checked only of an op that takes effect at once. */
    held?: boolean;
    /** Whether a pack's action or handler makes the change. */
    pack?: boolean;
    /** Whether a drawing asked for the change, which the page sends as the person (src/layout-changes.ts). */
    drawing?: boolean;
    /** "outside": it writes a type, a link type or a field outside the reach of the pack that makes it (src/manifest.ts), or of a drawing, the types its style declares (writes). */
    reach?: 'outside';
    /** For a rule on a reply's end: what the reply did (true) or did not (false), as its hook read it. */
    reply?: Record<string, boolean>;
  };
  then?: 'hold' | 'refuse' | 'ask' | { require: string[] };
  /** For a rule on a reply's end that reads unaccounted: what accounts for a commit, a type and its field holding the full sha. */
  record?: { type: string; field: string };
  /** Fields whose values together may belong to one item of the type only. */
  unique?: string[];
  /** For unique: the type it holds within, flavours included. */
  type?: string;
  /** What a refusal says, and why a held change waits. {title} is the item's. */
  say?: string;
  /** A workspace setting (agent_...) by which its owner lifts this rule there: while it is on, the rule does not apply. */
  lifted?: string;
  /** Where the workspace has not set lifted, the server's policy for the op lifts it (auto) or not. */
  server?: boolean;
  /** Whether a report's reading, a measurement, is under it. Left out: a refusal is, a hold is not. */
  readings?: boolean;
  /** A retention rule: the compacted stream its facts go to (docs/log.md, section 4), with keep in place of then. */
  stream?: string;
  /** What compaction leaves of them (src/retention.ts). */
  keep?: Keep;
}

export type Rule = RuleDef & { pack: string };

/** The rule that decided something, as a change's answer and a held proposal name it. */
export interface Ruled {
  rule: string;
  pack: string;
  say: string;
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

/** Who sends a change, as the rules read them. */
export interface Who {
  human: boolean;
  /** A report's reading: a measurement, applied as it comes unless a rule says readings are under it. */
  reading?: boolean;
  /** What the token may do. */
  may?: string;
  /** The change asks to wait. */
  asked?: boolean;
  /** The change says on whose authority it is made. */
  said?: boolean;
  /** The pack whose action or handler makes the change. */
  pack?: string;
  /** The drawing that asked for it: its style, and the types it declares it writes. A rule holds it though a person sends it. */
  drawing?: { style: string; writes: string[] };
}

const list = (x: OneOrMany | undefined) => (x === undefined ? undefined : Array.isArray(x) ? x : [x]);
/** The settings an owner lifts a rule by: each one an agent's token may read (src/schema.ts, AGENT_CODE_READ). On is true, or "apply". */
export const LIFTS = ['agent_changes', 'agent_code', 'agent_publish', 'agent_backups'];
/** The lift by which agents' changes apply as they are made; a new workspace begins with it (beginApplying). */
export const AGENT_CHANGES = 'agent_changes';
const COMPARE = /^\s*([a-z_][a-z0-9_]*)\s*(>=|<=|!=|>|<|=)\s*(-?\d+(?:\.\d+)?|[a-z_][a-z0-9_]*)\s*$/;

/** Problems with a pack's rules, given the registry it loads into. Empty means they can be enforced. */
export function checkRules(rules: RuleDef[], reg: Pick<Registry, 'types'>): string[] {
  const problems: string[] = [];
  const known = (t: string) => reg.types.has(t);
  for (const [i, rule] of rules.entries()) {
    const at = `rule ${rule.id ?? i + 1}`;
    if (rule.on !== undefined) {
      problems.push(...checkReplyRule(rule, at, known));
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
    for (const t of [...(list(rule.when?.type) ?? []), ...(list(rule.when?.kind) ?? [])]) if (!known(t)) problems.push(`${at}: no type "${t}"`);
    if (rule.when?.compare !== undefined && !COMPARE.test(rule.when.compare)) problems.push(`${at}: compare reads like "total > 500"`);
    if (rule.when?.reach !== undefined && rule.when.reach !== 'outside') problems.push(`${at}: reach is "outside", for what a pack writes outside its reach`);
    if (rule.lifted !== undefined && !LIFTS.includes(rule.lifted)) problems.push(`${at}: lifted is one of ${LIFTS.join(', ')}`);
    if (rule.server && !rule.lifted) problems.push(`${at}: server says what lifts it where the workspace has not set lifted, so it needs lifted`);
  }
  return problems;
}

/** Whether a type has a capability, or has it as the rule asks. */
function capable(reg: Registry, type: string, wanted: string | Record<string, Record<string, unknown>>): boolean {
  const has = reg.types.get(type)?.capabilities as Record<string, Record<string, unknown> | undefined> | undefined;
  if (!has) return false;
  if (typeof wanted === 'string') return has[wanted] !== undefined;
  return Object.entries(wanted).every(([name, fields]) => has[name] !== undefined && Object.entries(fields).every(([k, v]) => has[name]![k] === v));
}

/** Whether a rule's when holds for one op written by this actor to these targets (none for a create). */
function applies(rule: RuleDef, reg: Registry, who: Who, w: Written, targets: Target[], held: boolean): boolean {
  const when = rule.when ?? {};
  if (when.actor && (when.actor === 'human') !== who.human) return false;
  if (who.reading && !(rule.readings ?? rule.then !== 'hold')) return false;
  if (when.op && !list(when.op)!.includes(w.op)) return false;
  if (when.asked !== undefined && Boolean(who.asked) !== when.asked) return false;
  if (when.may !== undefined && who.may !== when.may) return false;
  if (when.said !== undefined && Boolean(who.said) !== when.said) return false;
  if (when.held !== undefined && held !== when.held) return false;
  if (when.pack !== undefined && Boolean(who.pack) !== when.pack) return false;
  if (when.drawing !== undefined && Boolean(who.drawing) !== when.drawing) return false;
  if (when.reach === 'outside' && !(who.pack ? outsideReach(reg, who.pack, w, targets) : who.drawing && outsideLayout(reg, who.drawing.writes, w, targets))) return false;
  if (when.dormant !== undefined) {
    const asleep = [w.op === 'create' || w.op === 'link' ? w.type : undefined, ...targets.map((t) => t.type)].some((t) => t && (reg.types.get(t)?.dormant || reg.relations.get(t)?.dormant));
    if (asleep !== when.dormant) return false;
  }
  const types = w.op === 'create' && w.type ? [w.type] : targets.map((t) => t.type);
  const of = (wanted: string[] | undefined) => !wanted || types.some((t) => wanted.some((x) => reg.isA(t, x)));
  if (!of(list(when.type)) || !of(list(when.kind))) return false;
  if (when.capability && !types.some((t) => capable(reg, t, when.capability!))) return false;
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

/**
 * What an op writes outside a pack's reach, if anything: a type or link type it neither declares nor requires (nor
 * uses while that pack is active), or a field another pack outside its reach added to a type. Undefined when inside.
 */
export function outsideReach(reg: Registry, pack: string, w: Written, targets: Target[]): string | undefined {
  const types = w.op === 'create' || w.op === 'link' ? (w.type ? [w.type] : []) : targets.map((t) => t.type);
  for (const t of types) {
    if (!inReach(reg, pack, t)) return t;
    for (const field of Object.keys(w.props ?? {})) if (!fieldInReach(reg, pack, t, field)) return `${t} (its field ${field})`;
  }
  return undefined;
}

/** What an op a drawing asked for writes outside the types its style declares (flavours included), if anything: a link is always outside. */
export function outsideLayout(reg: Registry, writes: string[], w: Written, targets: Target[]): string | undefined {
  if (w.op === 'link' || w.op === 'unlink') return w.type ?? 'a link';
  const types = w.op === 'create' ? (w.type ? [w.type] : []) : targets.map((t) => t.type);
  if (!types.length) return w.type ?? 'an item it cannot find';
  return types.find((t) => !writes.some((x) => reg.isA(t, x)));
}

/** Whether a rule is lifted for this op: by its setting, or where the workspace has not set it, by the server's policy. */
export type Lifted = (rule: RuleDef, op: string) => boolean;

/** What the rules make of one op: the rules that hold it, the ones a lift spared it, and what refuses it. */
export function judge(rules: Rule[], reg: Registry, who: Who, w: Written, targets: Target[], lifted: Lifted = () => false) {
  const held: Ruled[] = [];
  const spared: Ruled[] = [];
  const refused: string[] = [];
  const title = targets[0]?.title ?? String((w as { title?: string }).title ?? '');
  const said = (rule: Rule, fallback: string) =>
    (rule.say ?? fallback).replaceAll('{title}', title).replaceAll('{pack}', who.pack ?? '').replaceAll('{type}', () => (who.pack && outsideReach(reg, who.pack, w, targets)) || (who.drawing && outsideLayout(reg, who.drawing.writes, w, targets)) || w.type || targets[0]?.type || '');
  const ruled = (rule: Rule): Ruled => ({ rule: rule.id ?? '', pack: rule.pack, say: said(rule, `${rule.pack}'s rule${rule.id ? ` ${rule.id}` : ''}`) });
  // What is checked only of an op that takes effect at once comes after what holds it.
  const order = [...rules.filter((r) => r.when?.held === undefined), ...rules.filter((r) => r.when?.held !== undefined)];
  for (const rule of order) {
    if (rule.unique || rule.stream || onReply(rule) || !applies(rule, reg, who, w, targets, held.length > 0)) continue;
    if (rule.lifted && lifted(rule, w.op)) {
      spared.push(ruled(rule));
      continue;
    }
    if (rule.then === 'hold') {
      // A person's own change waits for nobody; one a drawing asked for waits for that person.
      if (!who.human || (who.drawing && rule.when?.drawing)) held.push(ruled(rule));
    } else if (rule.then === 'refuse') refused.push(said(rule, `"${title}": refused by ${rule.pack}'s rule${rule.id ? ` ${rule.id}` : ''}`));
    else if (typeof rule.then === 'object') {
      const props = { ...targets[0]?.props, ...w.props };
      const missing = rule.then.require.filter((f) => props[f] == null || props[f] === '');
      if (missing.length) refused.push(said(rule, `"${title}": needs ${missing.join(', ')}`));
    }
  }
  return { held, spared, refused };
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

/** The rules the server's policy adds: an op it forbids agents is refused, whatever the workspace lets them do. */
export function serverRules(policy: Partial<Policy>): Rule[] {
  const forbidden = Object.entries(policy).filter(([, level]) => level === 'forbidden').map(([op]) => op);
  return forbidden.map((op) => ({ id: 'server_forbids', pack: 'server', when: { actor: 'agent', op }, then: 'refuse', readings: false, say: `Policy forbids agents from: ${op}` }));
}

/** How the lifts stand in this workspace: each liftable setting as it is set, read once for a change. */
async function liftsOf(q: Q, rules: Rule[], policy: Partial<Policy>): Promise<Lifted> {
  const names = [...new Set(rules.flatMap((r) => (r.lifted ? [r.lifted] : [])))];
  const rows = names.length ? (await q.query<{ key: string; value: unknown }>(`select key, value from setting where key = any($1::text[])`, [names])).rows : [];
  const set = new Map(rows.map((r) => [r.key, r.value]));
  return (rule, op) => {
    const value = set.get(rule.lifted!);
    if (value === true || value === 'apply') return true;
    if (value === false || value === 'hold' || !rule.server) return false;
    return policy[op as OpKind] === 'auto';
  };
}

/**
 * A workspace begins: what its agents change takes effect as they make it, until the owner says otherwise (the owner,
 * 21 Oct and 1 Nov 2026). Only for one that has held nothing, or has no owner yet: one that never chose stays held.
 * Answers the fact to put on the settings stream, if it was set here.
 */
export async function beginApplying(q: Q): Promise<['+', string, string, unknown][]> {
  const { rows } = await q.query(`insert into setting (key, value) values ($1, '"apply"'::jsonb) on conflict (key) do nothing returning key`, [AGENT_CHANGES]);
  return rows.length ? [['+', 'setting', AGENT_CHANGES, 'apply']] : [];
}

/** What a workspace's agent_changes comes to: its own choice, or what the server's policy does with an agent's change. */
export async function agentChanges(q: Q, policy: Policy): Promise<'apply' | 'hold'> {
  const { rows } = await q.query<{ value: unknown }>(`select value from setting where key = $1`, [AGENT_CHANGES]);
  const chosen = rows[0]?.value;
  if (chosen === 'apply' || chosen === 'hold') return chosen;
  return Object.values(policy).every((level) => level === 'auto') ? 'apply' : 'hold';
}

/** Whether each liftable setting is on here, as the Workspace page shows them. */
export async function liftsOn(q: Q): Promise<Record<string, boolean>> {
  const { rows } = await q.query<{ key: string; value: unknown }>(`select key, value from setting where key = any($1::text[])`, [LIFTS]);
  const set = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(LIFTS.map((key) => [key, set.get(key) === true || set.get(key) === 'apply']));
}

export interface Verdict {
  /** What becomes of the change: it applies, waits for a person, or is refused. */
  outcome: 'apply' | 'hold' | 'refuse';
  /** The rule that decided it, when one held it: the most particular of those that did. */
  by?: Ruled;
  /** Every rule that holds it. */
  held: Ruled[];
  refused: string[];
  /** For each op, the rules it would be under but for a setting or the server that lifted them. */
  spared: Ruled[][];
}

/** How particular a rule is: the more it asks of a change, the more it says about why one waits. */
const particular = (r: Ruled, rules: Rule[]) => Object.keys(rules.find((x) => x.id === r.rule && x.pack === r.pack)?.when ?? {}).length;

/** What the rules make of a change: whether it applies, waits or is refused, and the rule that decided it. */
export async function decide(q: Q, reg: Registry, who: Who, given: { op: string }[], policy: Partial<Policy> = {}): Promise<Verdict> {
  const rules = [...serverRules(policy), ...reg.rules];
  const lifted = who.human && !who.drawing ? () => false : await liftsOf(q, rules, policy);
  const ops = given as (Written & { id?: string; keep?: string; drop?: string })[];
  const on = (op: (typeof ops)[number]) => (op.op === 'merge' ? [op.keep!, op.drop!] : op.id ? [op.id] : []);
  const found = new Map((await q.query<Target>(`select id, type, title, status, props from entity where id = any($1::text[])`, [ops.flatMap(on)])).rows.map((e) => [e.id, e]));
  const judged = await Promise.all(ops.map(async (op) => {
    const targets = on(op).flatMap((id) => found.get(id) ?? []);
    const one = judge(rules, reg, who, op, targets, lifted);
    return { ...one, refused: [...one.refused, ...(await clashes(q, reg, op, targets[0]))] };
  }));
  const refused = judged.flatMap((j) => j.refused);
  const held = judged.flatMap((j) => j.held);
  const by = [...held].sort((a, b) => particular(b, rules) - particular(a, rules))[0];
  return { outcome: refused.length ? 'refuse' : held.length ? 'hold' : 'apply', by, held, refused, spared: judged.map((j) => j.spared) };
}

/** Whether this actor may do an act that is not a change: refused, with the rule's reason, when a rule refuses it. */
export async function mayDo(q: Q, reg: Registry, human: boolean, act: string): Promise<void> {
  const verdict = await decide(q, reg, { human }, [{ op: act }]);
  if (verdict.refused.length) throw new Error(verdict.refused.join('\n'));
}
