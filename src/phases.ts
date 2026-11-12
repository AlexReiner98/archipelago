// Where a status stands in its course: its phase (decision e_bns7ak6j). The phase is what the word means, so a type
// says it where it says its statuses (`statuses.phases`, by status), and every drawing and reader reads the same one.
// A status no type in its lineage gives a phase is read from its place: the first of several open statuses not
// started, a later one under way, the first closed finished, a later one ended; a lone open status is standing (it
// is, and is not on its way anywhere), and what stands does not finish but ends. Trouble is only ever said.

import type { Statuses } from '../packs/loader/kernel/packs.ts';

export const PHASES = ['not_started', 'under_way', 'finished', 'ended', 'trouble', 'standing'] as const;
export type Phase = (typeof PHASES)[number];

/** Each status its phase: what the type says, else what its nearest ancestor says of the same word, else its place. */
export function phasesOf(statuses: Statuses, declared: (Record<string, string> | undefined)[]): Record<string, Phase> {
  const said = (s: string) => declared.map((d) => d?.[s]).find((p): p is Phase => PHASES.includes(p as Phase));
  const standing = statuses.open.length === 1 && (said(statuses.open[0]) ?? 'standing') === 'standing';
  const placed = (s: string, k: number, open: boolean): Phase => (open ? (k ? 'under_way' : standing ? 'standing' : 'not_started') : standing ? 'ended' : k ? 'ended' : 'finished');
  return Object.fromEntries([...statuses.open.map((s, k) => [s, said(s) ?? placed(s, k, true)]), ...statuses.closed.map((s, k) => [s, said(s) ?? placed(s, k, false)])]);
}

/** Problems with a type's declared phases: each names one of its statuses, and is one of the phases. */
export function checkPhases(statuses: Statuses): string[] {
  const all = [...statuses.open, ...statuses.closed];
  return Object.entries(statuses.phases ?? {}).flatMap(([s, p]) => [
    ...(all.includes(s) ? [] : [`phases names "${s}", which is no status of it`]),
    ...(PHASES.includes(p as Phase) ? [] : [`the phase of "${s}" is "${p}", not one of ${PHASES.join(', ')}`]),
  ]);
}
