// A rule's own examples (task e_qzhezahm, after UI design's two rules that misbehaved only on the live map, 18 Nov 2026):
// each a small change on made-up items (refs only) and what it must come to. As a pack's manifest is written (a pack
// item's change, packs/loader/kernel/type-items.ts) or a pack.json loads (packs/loader/kernel/open.ts), each is judged
// by `decide` (./rules.ts hands it in as it fills the loader's slot) under the pack's own rules as the manifest has them,
// against a map that holds nothing, so nothing is written and no workspace's items or settings sway it. One that comes
// out otherwise refuses the manifest.

import type { Q } from '../../database/kernel/db.ts';
import type { Registry } from '../../loader/kernel/packs.ts';
import type { decide, Who } from './rules.ts';
import type { FormOp } from './rule-forms.ts';

export interface Example {
  /** What it is, for the refusal to name; left out, its place in the list. */
  name?: string;
  /** The change, on items it makes: every id, from and to is a ref of a create in it. */
  ops: FormOp[];
  /** What it must come to: it applies, waits for a person, or is refused. */
  expect: 'applied' | 'held' | 'refused';
  /** Who sends it: an agent (left out) or a human. */
  actor?: 'agent' | 'human';
  /** It says it is made on the owner's word. */
  owner_said?: boolean;
}

const OUTCOME = { apply: 'applied', hold: 'held', refuse: 'refused' } as const;
/** A map that holds nothing: every read answers no rows. */
const NOTHING = { query: async () => ({ rows: [] }) } as unknown as Q;

/** Problems with an example's form: a change on its own refs, and an outcome. */
function formOf(ex: Example, at: string): string[] {
  if (!ex || typeof ex !== 'object' || !Array.isArray(ex.ops) || !ex.ops.length) return [`${at}: an example is { ops, expect }, its ops a change`];
  const problems: string[] = [];
  if (!Object.values(OUTCOME).includes(ex.expect)) problems.push(`${at}: expect is applied, held or refused`);
  if (ex.actor !== undefined && ex.actor !== 'agent' && ex.actor !== 'human') problems.push(`${at}: actor is agent or human`);
  const refs = new Set(ex.ops.flatMap((o) => (o?.op === 'create' && o.ref ? [o.ref] : [])));
  const named = ex.ops.flatMap((o) => [o?.id, o?.from, o?.to].filter((x): x is string => typeof x === 'string'));
  const stored = named.filter((x) => !refs.has(x));
  if (stored.length) problems.push(`${at}: an example names only items it makes, by ref: not ${[...new Set(stored)].join(', ')}`);
  return problems;
}

/** Each example of a pack's rules that does not come to what it says, judged under its rules in `reg` (the manifest as it will be). */
export async function exampleProblems(reg: Registry, pack: string, judge: typeof decide): Promise<string[]> {
  const own = reg.rules.filter((r) => r.pack === pack);
  const withExamples = own.filter((r) => r.examples !== undefined);
  if (!withExamples.length) return [];
  const under = Object.create(reg, { rules: { value: own } }) as Registry; // the pack's own rules alone: core's, the server's and other packs' say nothing here
  const problems: string[] = [];
  for (const rule of withExamples) {
    const rid = `rule ${rule.id ?? '(unnamed)'}`;
    if (!Array.isArray(rule.examples)) { problems.push(`${rid}: examples is a list`); continue; }
    for (const [i, ex] of rule.examples.entries()) {
      const at = `${rid}, example ${ex?.name ? `"${ex.name}"` : i + 1}`;
      const wrong = formOf(ex, at);
      if (wrong.length) { problems.push(...wrong); continue; }
      const who: Who = { human: ex.actor === 'human', said: true, ownerSaid: Boolean(ex.owner_said) };
      let came: string;
      let why = '';
      try {
        const v = await judge(NOTHING, under, who, structuredClone(ex.ops));
        came = OUTCOME[v.outcome];
        why = v.refused[0] ?? v.by?.say ?? '';
      } catch (err) {
        came = 'an error'; why = (err as Error).message;
      }
      if (came !== ex.expect) problems.push(`${at} should be ${ex.expect}, and is ${came}${why ? ` (${why})` : ''}`);
    }
  }
  return problems;
}
