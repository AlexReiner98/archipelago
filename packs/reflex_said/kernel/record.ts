// Whether a said instruction stops its miss, decided without the map: the sayings, the runs' stories and what each
// instruction answers in, each instruction's record out. Imports nothing; reads.ts hands it what it reads.
//
// A miss is a refusal in a run's story (a beat that befell it, did "refused") whose words hold a phrase the instruction
// names (its field misses), or one about an item it answers (its answers links). Per run, an instruction is judged
// from the first time it was said there: a miss after it came back; a miss before and none after was held; none at all
// is quiet, which says nothing either way.

/** One saying, as the stream keeps it. */
export interface Saying {
  id: string;
  run: string;
  where: string;
  at: string;
}

/** A beat of a run's story, as the sessions pack keeps it. */
export interface Beat {
  at: string;
  said: string;
  about?: string[];
  did?: string;
}

/** What an instruction answers: refusal phrases, and the items its answers links point to. */
export interface Answering {
  id: string;
  misses: string[];
  answers: string[];
}

/** How one run went for one instruction. */
export interface RunVerdict {
  run: string;
  /** The first time it was said in the run. */
  said_at: string;
  /** How many times it was said there. */
  said: number;
  /** Misses it answers before it was first said, and after. */
  before: number;
  after: number;
  verdict: 'came_back' | 'held' | 'quiet';
}

/** One instruction's record. */
export interface Record_ {
  id: string;
  said: number;
  runs: number;
  /** How many times it was said at each place. */
  places: Record<string, number>;
  last?: string;
  came_back: number;
  held: number;
  quiet: number;
  per_run: RunVerdict[];
}

const lower = (s: string) => s.toLowerCase();

/** Whether a beat is a miss this instruction answers. */
export function isMiss(beat: Beat, answering: Answering | undefined): boolean {
  if (!answering || beat.did !== 'refused') return false;
  const words = lower(beat.said ?? '');
  if (answering.misses.some((p) => p.trim() && words.includes(lower(p.trim())))) return true;
  return (beat.about ?? []).some((id) => answering.answers.includes(id));
}

/** Each instruction's record, in the order the ids are given; one never said has a record of zeros. */
export function records(ids: string[], sayings: Saying[], stories: Record<string, Beat[]>, answering: Answering[]): Record_[] {
  const by = new Map(answering.map((a) => [a.id, a]));
  return ids.map((id) => {
    const mine = sayings.filter((s) => s.id === id).sort((a, b) => a.at.localeCompare(b.at));
    const places: Record<string, number> = {};
    for (const s of mine) places[s.where] = (places[s.where] ?? 0) + 1;
    const runs = [...new Set(mine.map((s) => s.run))];
    const per_run = runs.map((run): RunVerdict => {
      const here = mine.filter((s) => s.run === run);
      const said_at = here[0].at;
      const misses = (stories[run] ?? []).filter((b) => isMiss(b, by.get(id)));
      const before = misses.filter((b) => b.at < said_at).length;
      const after = misses.length - before;
      return { run, said_at, said: here.length, before, after, verdict: after ? 'came_back' : before ? 'held' : 'quiet' };
    });
    const count = (v: RunVerdict['verdict']) => per_run.filter((r) => r.verdict === v).length;
    return { id, said: mine.length, runs: runs.length, places, ...(mine.length && { last: mine.at(-1)!.at }), came_back: count('came_back'), held: count('held'), quiet: count('quiet'), per_run };
  });
}

/** The facts one saying is kept as: one per instruction said, about it, its field said. */
export const sayingFacts = (ids: string[], run: string, where: string): ['+', string, string, unknown][] =>
  [...new Set(ids)].map((id) => ['+', id, 'said', { run, where }]);

/** A kept entry's facts read back as sayings: those of the field said with a run and a place, at the entry's time. */
export function sayingsOf(entries: { at: string; facts: unknown[] }[]): Saying[] {
  const out: Saying[] = [];
  for (const e of entries) {
    for (const f of e.facts) {
      if (!Array.isArray(f) || f[0] !== '+' || f[2] !== 'said') continue;
      const v = f[3] as { run?: unknown; where?: unknown } | null;
      if (typeof f[1] === 'string' && v && typeof v.run === 'string' && typeof v.where === 'string') out.push({ id: f[1], run: v.run, where: v.where, at: e.at });
    }
  }
  return out;
}
