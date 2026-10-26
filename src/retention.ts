// Retention rules (docs/log.md, section 4): what a compacted stream keeps of its entries, declared as data in a pack
// file's `rules` with a `stream` and a `keep` in place of `then`, checked with the other rules (src/rules.ts) and judged
// here without a database: entries and the time in, the positions kept out. An entry is never rewritten: it is kept
// whole while any fact in it is kept, and dropped whole once none is.

/** What compaction leaves of a stream's facts. */
export interface Keep {
  /** The newest value of each (id, field), while the record lives. */
  latest?: boolean;
  /** Older values, this long (an ISO 8601 duration). */
  history?: string;
  /** Of values older than `after`, one per `every`: [[after, every], ...]. */
  thin?: [string, string][];
  /** How long a record is kept at all after it ends (a run ended, a claim released, a notification read). */
  closed?: string;
  /** How long a record that has not ended is kept after its last fact (a notification never read). */
  open?: string;
  /** Never compacted. */
  forever?: boolean;
}

/** A retention rule as a pack declares it; `pack` is added on loading. */
export interface Retention {
  id?: string;
  pack?: string;
  when?: { fields?: string[] };
  stream?: string;
  keep?: Keep;
}

/** The streams the kernel appends to, besides the fact stream; a pack's own is `pack:<id>`. */
export const STREAMS = ['sessions', 'claims', 'notifications', 'automations', 'settings', 'access', 'observations', 'places'] as const;
const PACK_STREAM = /^pack:([a-z][a-z0-9_]*|\*)$/;
export const isStream = (s: string) => (STREAMS as readonly string[]).includes(s) || PACK_STREAM.test(s);

const DURATION = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

/** An ISO 8601 duration in weeks, days, hours, minutes and seconds, in milliseconds; undefined when it is not one. */
export function duration(iso: string | undefined): number | undefined {
  const m = typeof iso === 'string' ? DURATION.exec(iso) : null;
  if (!m || iso === 'P' || iso!.endsWith('T')) return undefined;
  const [w, d, h, min, s] = m.slice(1).map((x) => Number(x ?? 0));
  return ((((w * 7 + d) * 24 + h) * 60 + min) * 60 + s) * 1000;
}

/** Problems with one retention rule; `at` names it. */
export function checkRetention(rule: Retention & { then?: unknown }, at: string): string[] {
  const problems: string[] = [];
  if (rule.stream === undefined) return rule.keep ? [`${at}: keep needs the stream it keeps`] : [];
  if (!isStream(rule.stream)) problems.push(`${at}: stream is one of ${STREAMS.join(', ')} or pack:<id>`);
  if (rule.then !== undefined) problems.push(`${at}: a retention rule has keep in place of then`);
  const keep = rule.keep;
  if (!keep || typeof keep !== 'object') return [...problems, `${at}: a stream's rule says what it keeps (keep)`];
  const known = ['latest', 'history', 'thin', 'closed', 'open', 'forever'];
  for (const k of Object.keys(keep)) if (!known.includes(k)) problems.push(`${at}: keep has no "${k}" (${known.join(', ')})`);
  for (const k of ['history', 'closed', 'open'] as const) if (keep[k] !== undefined && duration(keep[k]) === undefined) problems.push(`${at}: keep.${k} is an ISO 8601 duration, like "P14D"`);
  if (keep.thin !== undefined) {
    const tiers = Array.isArray(keep.thin) ? keep.thin : [];
    if (!tiers.length || tiers.some((t) => !Array.isArray(t) || t.length !== 2 || duration(t[0]) === undefined || !duration(t[1])))
      problems.push(`${at}: keep.thin is [[after, every], ...] in ISO 8601 durations, like [["P1D", "PT1H"]]`);
    else if (tiers.some((t, i) => i > 0 && duration(t[0])! <= duration(tiers[i - 1][0])!)) problems.push(`${at}: keep.thin's tiers go from the youngest to the oldest`);
  }
  if (keep.forever && Object.keys(keep).length > 1) problems.push(`${at}: keep.forever keeps everything: it stands alone`);
  if (rule.when && Object.keys(rule.when).some((k) => k !== 'fields')) problems.push(`${at}: a retention rule selects by fields only`);
  return problems;
}

/** The retention rule an entry's facts are kept by: the one naming one of their fields, else the stream's own. */
export function ruleFor<R extends Retention>(rules: R[], stream: string, field: string): R | undefined {
  const of = rules.filter((r) => r.stream === stream || (r.stream === 'pack:*' && stream.startsWith('pack:')));
  return of.find((r) => r.when?.fields?.includes(field)) ?? of.find((r) => !r.when?.fields);
}

/** An entry of a compacted stream as compaction reads it. */
export interface OpEntry {
  pos: number;
  at: string;
  rule: string;
  facts: (['+', string, string, unknown] | ['-', string, string])[];
}

/**
 * The positions compaction keeps, at `now`. `closedAt` says when a record ended, if it has; a link retracted in the
 * stream itself ends there. An entry whose rule is not known is kept: compaction never drops what no rule names.
 */
export function kept(entries: OpEntry[], rules: Retention[], now: Date, closedAt: (id: string) => Date | undefined = () => undefined): Set<number> {
  const t = now.getTime();
  const byId = new Map(rules.filter((r) => r.keep).map((r) => [r.id, r.keep!]));
  const ended = new Map<string, number>();
  const last = new Map<string, number>();
  const newest = new Map<string, number>(); // (id, field) -> the position of its newest fact
  for (const e of [...entries].sort((a, b) => a.pos - b.pos)) {
    const at = Date.parse(e.at);
    for (const f of e.facts) {
      last.set(f[1], at);
      newest.set(`${f[1]}\u0000${f[2]}`, e.pos);
      if (f[0] === '-' && f[2] === 'link') ended.set(f[1], at);
    }
  }
  const out = new Set<number>();
  const thinned = new Set<string>(); // (id, field, tier, bucket) already kept, newest first
  for (const e of [...entries].sort((a, b) => b.pos - a.pos)) {
    const keep = byId.get(e.rule);
    if (!keep || keep.forever) {
      out.add(e.pos);
      continue;
    }
    const at = Date.parse(e.at);
    const age = t - at;
    const one = (f: OpEntry['facts'][number]) => {
      const end = ended.get(f[1]) ?? closedAt(f[1])?.getTime();
      if (end !== undefined && keep.closed !== undefined && t - end > duration(keep.closed)!) return false;
      if (end === undefined && keep.open !== undefined && t - last.get(f[1])! > duration(keep.open)!) return false;
      const key = `${f[1]}\u0000${f[2]}`;
      if (keep.latest && newest.get(key) === e.pos) return true;
      if (keep.history !== undefined && age <= duration(keep.history)!) return true;
      if (keep.thin) {
        const tier = keep.thin.findLastIndex(([after]) => age > duration(after)!);
        if (tier < 0) return true; // younger than every tier: not yet thinned
        const bucket = `${key}\u0000${tier}\u0000${Math.floor(at / duration(keep.thin[tier][1])!)}`;
        if (!thinned.has(bucket)) return thinned.add(bucket), true;
      }
      return false;
    };
    // Every fact is judged, so a thinned bucket is taken by the newest entry that has it even when another fact keeps it.
    const verdicts = e.facts.map(one);
    if (verdicts.some(Boolean)) out.add(e.pos);
  }
  return out;
}
