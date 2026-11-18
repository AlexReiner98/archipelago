// What the orchestration does to a session, told on its story: a task taken up, a resource claimed or given back, a
// change or a claim refused, a launch stopped. One entry point, `befell`, for every pack and root that does such a
// thing: the beat is kept as a session's own are (./session-life.ts, tell), marked with what befell it (`did`) and who
// told it (`by`), so the page draws it apart from the session's own words and the sessions view gives it as the line.
// Never fails what it tells of: a beat that cannot be kept is said in the server's log and the call goes on.

import type { KernelContext } from '#pelago/kernel';
import { resolveRun } from './chat-run.ts';
import { DIDS, tell, type Befell } from './session-life.ts';

/** A beat is a sentence: what befell is cut to it, with an ellipsis. */
const SAID_MAX = 280;
const cut = (said: string) => (said.length > SAID_MAX ? `${said.slice(0, SAID_MAX - 1)}…` : said);

/** Tell what befell a session on its story, as `by`. A run that is not a session, or a beat that cannot be kept, is let go. */
export async function befell(ctx: KernelContext, beat: Befell): Promise<{ beat: number } | undefined> {
  if (!DIDS.includes(beat.did)) throw new Error(`What befell a session is one of ${DIDS.join(', ')}: not "${beat.did}".`);
  const said = cut(beat.said.replace(/\s+/g, ' ').trim());
  if (!said) return undefined;
  // Held by a person or an agent rather than a session: it has no story to tell it on.
  if (!(await resolveRun(ctx, beat.run))) return undefined;
  try {
    const told = await tell(ctx, { kind: 'agent', name: beat.by }, { run: beat.run, said, about: beat.about ?? [], did: beat.did, by: beat.by });
    // The beat moved the tell stamp, so a page following the story hears it (the presence pack's).
    await ctx.call('act.report.told', {}).catch(() => {});
    return { beat: told.beat };
  } catch (err) {
    ctx.said(`${beat.did} on session ${beat.run}: not kept in its story (${(err as Error).message})`);
    return undefined;
  }
}

/** Tell each of what befell, in order. */
export async function befellAll(ctx: KernelContext, beats: Befell[]): Promise<void> {
  for (const b of beats) await befell(ctx, b);
}
