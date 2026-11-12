// Sessions as the map calls them, on the pack's context (./session-life.ts): each step a call shows is shown on the
// owner's page at once, by the presence pack's name (act.report.took), for the screen the map is read for (the read
// `whose`). The kernel reaches these through the adapter at src/sessions.ts, which makes the context of the map that
// asks; the story view is the query pack's (`story`, answered by the runs pack's answer.story).

import type { KernelContext } from '#pelago/kernel';
import * as chat from './chat-run.ts';
import * as life from './session-life.ts';
import { sessionLabelled, sessionPromptNamed } from './session-name.ts';
import type { Actor, Item } from './types.ts';

export { IDLE_MS, stretch, type Beat, type Shown } from './session-life.ts';
export type { Actor, Item } from './types.ts';

/** Each step shown on the owner's page at once; a page that missed one finds it when it next reads the sessions. */
export async function show(ctx: KernelContext, shown: life.Shown[]): Promise<void> {
  if (!shown.length) return;
  const whose = await ctx.reads({ whose: true });
  for (const step of shown) await ctx.call('act.report.took', { whose, step: { kind: 'other', ...step } }).catch((err) => ctx.said(`session ${step.run}: the owner's page could not be told: ${(err as Error).message}`));
}

/** Run one of the pack's calls with a list for what it shows, then show it. */
async function showing<T>(ctx: KernelContext, f: (shown: life.Shown[]) => Promise<T>): Promise<T> {
  const shown: life.Shown[] = [];
  const out = await f(shown);
  await show(ctx, shown);
  return out;
}

export const sessionStart = (ctx: KernelContext, actor: Actor, input: life.SessionSaid) => showing(ctx, (shown) => life.sessionStart(ctx, actor, input, shown));
export const sessionUpdate = (ctx: KernelContext, actor: Actor, input: Parameters<typeof life.sessionUpdate>[2]) => showing(ctx, (shown) => life.sessionUpdate(ctx, actor, input, shown));
export const sessionEnd = (ctx: KernelContext, actor: Actor, input: life.EndInput) => showing(ctx, (shown) => life.sessionEnd(ctx, actor, input, shown));

/** What a session's client calls it now, kept, and shown on every page open at once (./session-name.ts). */
export const labelled = (ctx: KernelContext, run: Item, label: unknown, actor = 'agent:claude-code') =>
  showing(ctx, async (shown) => void ((await sessionLabelled(ctx, run, label, actor)) && shown.push({ actor, did: 'titled', run: run.id })));
/** A session still named after its folder, named by its first prompt, and shown at once. */
export const promptNamed = (ctx: KernelContext, run: Item, prompt: unknown, actor = 'agent:claude-code') =>
  showing(ctx, async (shown) => void ((await sessionPromptNamed(ctx, run, prompt, actor)) && shown.push({ actor, did: 'titled', run: run.id })));

export const resolveRun = chat.resolveRun;
export const sessionPrompted = chat.sessionPrompted;
export const sessionsAwake = chat.sessionsAwake;
export { recordRun } from './run-record.ts';
export { importAudit } from './audit.ts';
export { closeOffers } from './close-offer.ts';
export { hookWithin, sessionBegan, sessionHeard, recordUsage, tell, story } from './session-life.ts';
