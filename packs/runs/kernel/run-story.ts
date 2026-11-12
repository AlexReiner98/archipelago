// A run's story as a read (answer.story): the beats a session told of its work (report, action tell), kept on its run,
// in order, and which beat its page opens on. The query pack names it as its view `story`; the sessions pack writes it.

import type { KernelContext } from '#pelago/kernel';

/** A beat as a run keeps it: the fields its page reads to choose where it opens. */
type Beat = { n: number; finding?: boolean; asked?: string; replaced_by?: number; [more: string]: unknown };
type Run = { id: string; title: string; status: string; is_open: boolean; props: Record<string, unknown> };

/** A run's beats, and the one its page opens on: the latest finding that stands, else the latest beat the session said itself, not a rule. */
export async function story(ctx: KernelContext, input: Record<string, unknown>) {
  const key = String(input.run ?? '');
  // A run by its id, or by the session id its surface named it with.
  const run = key ? (((await ctx.reads({ run_of: { key } })) as Run | null) ?? undefined) : undefined;
  if (!run) throw new Error(`No session "${key}": give run, a run id or a session id.`);
  const beats = Array.isArray(run.props.story) ? (run.props.story as Beat[]) : [];
  const standing = beats.filter((b) => !b.replaced_by);
  const found = standing.findLast((b) => b.finding) ?? standing.findLast((b) => !b.asked) ?? standing.at(-1);
  return { run: { id: run.id, title: run.title, status: run.status, open: run.is_open }, finding: found?.n ?? null, beats };
}
