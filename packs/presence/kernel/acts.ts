// What the presence pack answers by name (pack.json, kernel.provides): the tool surface's acts ask it for the owner's
// screen (packs/surface/kernel/tool-acts.ts, tool-change.ts, tool-human.ts), each with whose screen it is (`whose`:
// the workspace and the person the map is read as), since a context names its workspace and not its reader.

import type { KernelContext } from '#pelago/kernel';
import { type Focus, looked, type Page, point, presence, runNamed, type Step, tellStamp, took, watching, type Whose } from './presence.ts';
import { inSight, seen, type Seen } from './seeing.ts';

/** How long a show brought into sight waits for the owner's page to say so: tries of so many ms. */
export const FOCUS_TRIES = 12;
export const FOCUS_MS = 500;

/** act.report.point: the screen pointed there, and the step that pointed it kept at once. */
export async function pointAct(ctx: KernelContext, input: { whose: Whose; focus: Focus; step: Omit<Step, 'at'> }): Promise<Focus> {
  await point(ctx, input.whose, input.focus);
  await took(ctx, input.whose, input.step, true);
  return input.focus;
}

/** act.report.took: a step taken, kept at once (a show, a change, a told beat: each comes with a write of its own). */
export const tookAct = async (ctx: KernelContext, input: { whose: Whose; step: Omit<Step, 'at'>; told?: boolean }): Promise<void> => {
  // A told beat moves the tell stamp first, so a page polling for it hears it.
  if (input.told) await tellStamp(ctx);
  await took(ctx, input.whose, input.step, true);
};

/**
 * answer.sight: whether a show of session `run` (or the one `actor` last named here) lands where the owner looks, and
 * the pages open on their screen. Brought into sight (`focus`), it is once their page has looked again (every two
 * seconds), so it is asked until then.
 */
export async function sightAnswer(ctx: KernelContext, input: { whose: Whose; actor: string; run?: string; focus?: boolean }) {
  const pages = await watching(ctx, input.whose);
  const run = input.run ?? runNamed(input.whose, input.actor);
  let sight = await inSight(ctx, input.whose, run, pages.open);
  for (let tries = 0; input.focus && pages.open && !sight.looking && tries < FOCUS_TRIES; tries++) {
    await new Promise((done) => setTimeout(done, FOCUS_MS));
    sight = await inSight(ctx, input.whose, run, pages.open);
  }
  return { pages, sight };
}

/** What a page polling for its screen says of itself: open (and whether it takes shows), and where it stands. */
export interface Polled extends Omit<Page, 'at'> {
  where?: string;
  tab?: Seen['tab'];
  lands?: string[];
}

/** act.report.screen: a page polled for its screen, saying what it is; answered with what that screen is given (presence). */
export async function screenAct(ctx: KernelContext, input: { whose: Whose; page?: Polled }) {
  const { whose, page } = input;
  if (page) await looked(ctx, whose, { page: page.page, on: page.on });
  if (page?.where !== undefined) await seen(ctx, whose, page.page, page.where, page.tab, page.lands);
  return presence(ctx, whose);
}
