// What went wrong, decided without the map: the runs' stories, the bumps and the traps in, misses out, each with
// where it happened (its for place) and the nodes that cover it. Imports nothing; reads.ts hands it what it reads.
//
// A miss is one of three (the owner's meanings, 19 Nov 2026, on e_yhqubh9k): a refusal (a beat that befell a run,
// did "refused"), a bump (an issue kept as a problem) or a trap (an instruction said for files, written at a session's
// end). A node covers a miss when it names it: a phrase of its misses in a refusal's words, an answers link to a bump,
// or, for a trap, the trap itself. A miss nothing covers is where a trial node may grow.

import { isMiss, type Answering, type Beat } from './record.ts';

/** A node as coverage reads it: what it answers, where it is said, and whether it is open. */
export interface Node extends Answering {
  for: string[];
  open: boolean;
}

/** A bump or a trap, with the run that wrote it, when, and where it is said (a trap's for). */
export interface Written {
  id: string;
  title: string;
  at: string;
  run?: string;
  for?: string[];
}

export interface Miss {
  kind: 'refusal' | 'bump' | 'trap';
  /** The beat's number in its run's story (a refusal), or the item's id (a bump, a trap). */
  key: string;
  run?: string;
  at: string;
  /** Where it happened: a tool (tool:change), a push, a file (file:<glob>), or bump where none is said. */
  where: string;
  said: string;
  /** The open nodes that cover it; none, it is uncovered. */
  covered_by: string[];
}

/** Where a refusal happened, read from who told it and its words: a change, a claim, a push. */
export function placeOf(beat: Beat & { by?: string }): string {
  const by = beat.by ?? '';
  if (by === 'write') return 'tool:change';
  if (by.includes('claim') || /^Could not claim/.test(beat.said)) return 'tool:assign';
  if (/^Refused .*\bpush|^Refused gh /i.test(beat.said)) return 'push';
  return by ? `by:${by}` : 'tool:change';
}

/** The refusals of some runs, each with its place and what covers it. */
export function refusals(stories: Record<string, (Beat & { n?: number; by?: string })[]>, nodes: Node[]): Miss[] {
  const open = nodes.filter((n) => n.open);
  return Object.entries(stories).flatMap(([run, story]) =>
    story
      .filter((b) => b.did === 'refused')
      .map((b) => ({ kind: 'refusal' as const, key: String(b.n ?? b.at), run, at: b.at, where: placeOf(b), said: b.said, covered_by: open.filter((n) => isMiss(b, n)).map((n) => n.id) })),
  );
}

/** Bumps, each covered by the open nodes that answer it. */
export const bumps = (written: Written[], nodes: Node[]): Miss[] =>
  written.map((w) => ({ kind: 'bump', key: w.id, ...(w.run && { run: w.run }), at: w.at, where: w.for?.[0] ?? 'bump', said: w.title, covered_by: nodes.filter((n) => n.open && n.answers.includes(w.id)).map((n) => n.id) }));

/** Traps: each a miss where it is said, covered by itself while it is open. */
export const traps = (written: Written[], nodes: Node[]): Miss[] =>
  written.map((w) => ({ kind: 'trap', key: w.id, ...(w.run && { run: w.run }), at: w.at, where: w.for?.find((f) => f.startsWith('file:')) ?? w.for?.[0] ?? 'file:', said: w.title, covered_by: nodes.some((n) => n.id === w.id && n.open) ? [w.id] : [] }));

/** Every miss, the newest first. */
export const missesOf = (parts: Miss[][]): Miss[] => parts.flat().sort((a, b) => b.at.localeCompare(a.at));

/**
 * The refusals of one run no node covers that came after the last time `asked` asked about them there (its beat in
 * the story): what a reply's end counts as missed. An ask covers what came before it, so each is asked about once.
 */
export function uncoveredSince(run: string, story: (Beat & { n?: number; by?: string; asked?: string })[], asked: string, nodes: Node[]): Miss[] {
  const last = story.reduce((at, b, i) => (b.asked === asked ? i : at), -1);
  return refusals({ [run]: story.slice(last + 1) }, nodes).filter((m) => !m.covered_by.length);
}
