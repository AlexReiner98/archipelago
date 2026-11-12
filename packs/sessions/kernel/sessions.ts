// Sessions as the map calls them: each call is the pack's own, on its context (./session-life.ts), handed the context
// of the map that asks. What is left here is what the pack cannot yet ask by a name (the wave 6b report, task
// e_5vtbam7d): showing a step on the owner's page at once (presence's took, which names no service), and the story view
// the kernel's VIEWS table holds (the query pack's). Both leave when their packs answer by name.

import type { Actor, Archipelago, Entity } from '../../../src/pelago.ts';
import { took } from '../../../src/presence.ts';
import { VIEWS } from '../../../src/views.ts';
import type { KernelContext } from '#pelago/kernel';
import * as chat from './chat-run.ts';
import * as life from './session-life.ts';
import { sessionLabelled, sessionPromptNamed } from './session-name.ts';
import { recordRun as record } from './run-record.ts';
import { importAudit as audit } from './audit.ts';
import { closeOffers as offers } from './close-offer.ts';

export { IDLE_MS, stretch, type Beat, type Shown } from './session-life.ts';

/**
 * The sessions pack's context of a map: the context its own calls get (src/kernel-context.ts). The kernel still names
 * the session acts and hooks on every map (tool-acts, the hook routes), so they run on the pack's code whether or not
 * the map has it on, as they did before it moved: where the map has not loaded it (switched off, or a map made with
 * other packs), its context is made from the pack as this server ships it.
 */
export const sessionsContext = async (l: Archipelago): Promise<KernelContext> => {
  const k = await import('../../../src/kernel-context.ts');
  if (l.registry.packs.some((p) => p.id === 'sessions')) return k.kernelContext(l, 'sessions');
  const shipped = (await import('../../../src/root-calls.ts')).ownManifest('sessions');
  if (!shipped) throw new Error('This server ships no sessions pack');
  return k.contextFor(l, shipped as Parameters<typeof k.contextFor>[1], k.hostAt(l));
};

/** Each step shown on the owner's page at once; a page that missed one finds it when it next reads the sessions. */
const show = async (l: Archipelago, shown: life.Shown[]) => {
  for (const step of shown) await took(l.db, l, { kind: 'other', ...step }, true).catch((err) => console.error(`session ${step.run}: the owner's page could not be told: ${(err as Error).message}`));
};

/** Run one of the pack's calls with a list for what it shows, then show it. */
async function showing<T>(l: Archipelago, f: (ctx: KernelContext, shown: life.Shown[]) => Promise<T>): Promise<T> {
  const shown: life.Shown[] = [];
  const out = await f(await sessionsContext(l), shown);
  await show(l, shown);
  return out;
}

export const resolveRun = async (l: Archipelago, key: string, openOnly = false) => (await chat.resolveRun(await sessionsContext(l), key, openOnly)) as Entity | undefined;
export const sessionPrompted = async (l: Archipelago, sessionId: string | undefined, actor: Actor) => chat.sessionPrompted(await sessionsContext(l), sessionId, actor);
export const sessionsAwake = async (l: Archipelago) => chat.sessionsAwake(await sessionsContext(l));
export const importAudit = async (l: Archipelago, actor: Actor, input: { connection: string }) => audit(await sessionsContext(l), actor, input);
export const closeOffers = async (l: Archipelago, ops: { op: string; id?: string; status?: string }[]) => offers(await sessionsContext(l), ops);
export const recordRun = async (l: Archipelago, actor: Actor, input: Parameters<typeof record>[2]) => record(await sessionsContext(l), actor, input);
export const hookWithin = async (l: Archipelago, within: string[], input: { session_id?: string; cwd?: string; remote?: string }, starting: boolean) => life.hookWithin(await sessionsContext(l), within, input, starting);
export const sessionBegan = async (l: Archipelago, sessionId: string | undefined) => life.sessionBegan(await sessionsContext(l), sessionId);
export const sessionStart = (l: Archipelago, actor: Actor, input: life.SessionSaid) => showing(l, (ctx, shown) => life.sessionStart(ctx, actor, input, shown));
export const sessionHeard = async (l: Archipelago, sessionId: string | undefined, turn?: 'begin' | 'until') => life.sessionHeard(await sessionsContext(l), sessionId, turn);
export const recordUsage = async (l: Archipelago, sessionId: string | undefined, tokens: unknown) => life.recordUsage(await sessionsContext(l), sessionId, tokens);
export const sessionUpdate = (l: Archipelago, actor: Actor, input: Parameters<typeof life.sessionUpdate>[2]) => showing(l, (ctx, shown) => life.sessionUpdate(ctx, actor, input, shown));
export const tell = async (l: Archipelago, actor: Actor, input: Parameters<typeof life.tell>[2]) => life.tell(await sessionsContext(l), actor, input);
export const story = async (l: Archipelago, input: Record<string, unknown>) => life.story(await sessionsContext(l), input);
export const sessionEnd = (l: Archipelago, actor: Actor, input: life.EndInput) => showing(l, (ctx, shown) => life.sessionEnd(ctx, actor, input, shown));

/** What a session's client calls it now, kept, and shown on every page open at once (./session-name.ts). */
export const labelled = (l: Archipelago, run: Entity, label: unknown, actor = 'agent:claude-code') =>
  showing(l, async (ctx, shown) => void ((await sessionLabelled(ctx, run, label, actor)) && shown.push({ actor, did: 'titled', run: run.id })));
/** A session still named after its folder, named by its first prompt, and shown at once. */
export const promptNamed = (l: Archipelago, run: Entity, prompt: unknown, actor = 'agent:claude-code') =>
  showing(l, async (ctx, shown) => void ((await sessionPromptNamed(ctx, run, prompt, actor)) && shown.push({ actor, did: 'titled', run: run.id })));

// Asked like any standing question; kept here, beside what writes it.
VIEWS.story = {
  description:
    'The story a session told of its work (report, action tell): its beats in order (n, said, about, links; one taken back says replaced_by; a finding says finding), and which beat its page opens on (finding: the latest finding that stands, else the latest beat). Its page draws what its finding is about with the flat lens. Params: run (required): a run id or session id.',
  run: story,
};
