// Where a session's checkout stood when it was last heard from (the hook says it at each turn's end and at the end):
// its branch and commit, its folder, how many of its commits no remote has, and how many files are not committed.
// Kept on the run as its git field, by operational and in no stream, as its heartbeat is: the newest is all that
// matters, and only until the work it names is pushed. The handoff reads it to say what sessions left behind.

import type { Archipelago } from './pelago.ts';
import { resolveRun } from './sessions.ts';

export interface GitState {
  branch: string;
  head: string;
  worktree: string;
  unpushed: number;
  dirty: number;
}

const text = (v: unknown, max: number) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined);
const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined);

/** A checkout's state as the hook sent it, or undefined when it is not one. */
export function gitOf(v: unknown): GitState | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const g = v as Record<string, unknown>;
  const state = { branch: text(g.branch, 255), head: typeof g.head === 'string' && /^[0-9a-f]{40}$/.test(g.head) ? g.head : undefined, worktree: text(g.worktree, 1000), unpushed: count(g.unpushed), dirty: count(g.dirty) };
  return Object.values(state).every((x) => x !== undefined) ? (state as GitState) : undefined;
}

/** Keep where a session's checkout stands on its run, when it is a checkout and has moved since it was last kept. */
export async function keepGit(l: Archipelago, session: string | undefined, sent: unknown): Promise<void> {
  const git = gitOf(sent);
  if (!git || !session) return;
  const run = await resolveRun(l, session, true);
  if (!run || JSON.stringify(gitOf(run.props.git)) === JSON.stringify(git)) return;
  await l.operational(run.id, { props: { git } });
}
