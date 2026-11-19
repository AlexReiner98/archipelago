// Rules as nodes of the tree, beside instructions (Alex, 19 Nov 2026: "show which is a rule and which is an
// instruction, and which pack each came from"). Decided without the map: the rules the packs declare and the uses
// stream's counts in, nodes and firings out. A rule guards a write, which comes through the change tool, so its place
// is read off its when as tool:change:<type>:<fields>, on the branch of what is said at tool:change; one on a reply's
// end goes under reply_ended, one on another event under it. Imports nothing; story-read.ts reads.

/** A rule as the registry holds it: the fields its place and effect are read from. */
export interface RuleDecl {
  id?: string;
  pack?: string;
  on?: string;
  stream?: string;
  then?: unknown;
  say?: string;
  when?: { op?: string | string[]; type?: string | string[]; capability?: unknown; fields?: string[]; reply?: Record<string, unknown>; actor?: string };
}

export interface RuleNode {
  id: string;
  kind: 'rule';
  pack: string;
  tier: 'core' | 'pack';
  effect: string;
  for: string[];
  title: string;
}

/** What a rule does when it holds: hold, refuse, ask, spare, requires (a field), carry. */
export function effectOf(then: unknown): string {
  if (typeof then === 'string') return then;
  if (then && typeof then === 'object') return 'require' in then ? 'requires' : 'carry' in then ? 'carry' : 'other';
  return 'other';
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v.join('|') : v);

/** Where a rule applies, as a place the tree branches by: tool:change:<type>:<fields>, or the event it is on. */
export function placeOf(rule: RuleDecl): string {
  const w = rule.when ?? {};
  if (rule.on === 'reply_ended') return ['reply_ended', ...Object.keys(w.reply ?? {})].join(':');
  if (rule.on) return rule.on;
  const kind = one(w.type) ?? (typeof w.capability === 'string' ? `has.${w.capability}` : w.capability ? `has.${Object.keys(w.capability as object).join('|')}` : undefined);
  return ['tool:change', kind, kind && w.fields?.length ? w.fields.join('|') : undefined].filter(Boolean).join(':');
}

/** A rule's id with its pack's, once: a hosted pack's rule may carry its pack's name already (build.lane_branch). */
export const ruleKey = (pack: string, id: string) => (id.startsWith(`${pack}.`) ? id : `${pack}.${id}`);
/** A key as the write path counts it (pack.rule, the pack's name maybe twice), as ruleKey makes it. */
const counted = (key: string) => key.replace(/^([a-z0-9_]+)\.\1\./, '$1.');

/** The rules in force as nodes: every rule that guards (a stream's retention rule keeps, it guards nothing). */
export const ruleNodes = (rules: RuleDecl[]): RuleNode[] =>
  rules
    .filter((r) => r.id && r.stream === undefined)
    .map((r) => ({ id: ruleKey(r.pack ?? 'core', r.id!), kind: 'rule', pack: r.pack ?? 'core', tier: r.pack === 'core' || !r.pack ? 'core' : 'pack', effect: effectOf(r.then), for: [placeOf(r)], title: r.say ? r.say.split(/[.:;]/)[0].slice(0, 80) : r.id! }));

/** The rules as the tree's drawing reads them: each with where and every firing in the window, as the start of its day, once per time. */
export const rulesRead = (nodes: RuleNode[], fired: Fired[]) =>
  nodes.map((r) => ({
    id: r.id, title: r.title, pack: r.pack, effect: r.effect, where: r.for[0],
    fired: fired.filter((f) => f.id === r.id).flatMap((f) => Array.from({ length: f.n }, () => `${f.day}T00:00:00.000Z`)),
  }));

/** A rule's firing on a day: held, refused or asked, how many times. */
export interface Fired {
  id: string;
  day: string;
  effect: 'held' | 'refused' | 'asked';
  n: number;
}

/** The uses stream's facts (['+', 'key:<kind>:<pack.rule>', day, n]) read as firings of these rules, in the window's days. */
export function firingsOf(entries: { facts: unknown[] }[], ids: Set<string>, days: [string, string]): Fired[] {
  const by = new Map<string, Fired>();
  for (const e of entries) {
    for (const f of e.facts) {
      if (!Array.isArray(f) || f[0] !== '+' || typeof f[1] !== 'string' || typeof f[2] !== 'string') continue;
      const m = /^key:(held|refused|asked):(.+)$/.exec(f[1]);
      const id = m && counted(m[2]);
      if (!m || !id || !ids.has(id) || f[2] < days[0] || f[2] > days[1]) continue;
      const key = `${id} ${f[2]} ${m[1]}`;
      const had = by.get(key) ?? { id, day: f[2], effect: m[1] as Fired['effect'], n: 0 };
      had.n += Number(f[3]) || 0;
      by.set(key, had);
    }
  }
  return [...by.values()].sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
}
