// A session started as a pack's answer. A pack that hears the kernel's clock tell it an item came due (item.due,
// src/due.ts) may answer with one launch, and the kernel starts it (src/launcher.ts) only when what came due is an
// enabled automation that says to launch just that: its own task, mode and instructions, checked as on write
// (src/automation-rules.ts). An automation is made, changed or brought back by an agent only with a human's approval
// (core's rule agent_automations, which nothing lifts), so the launch is on that human's authority, as the automation:
// the session it starts only proposes, and its run names the automation. Nothing else may launch this way: another
// call, another event, an event another pack recorded, an item of another type, a paused automation, or a launch that
// differs from what the automation says are each refused whole. Not while the session it last started is still open.

import { checkAutomation } from './automation-rules.ts';
import type { LaunchInput, LaunchMode, StartedBy } from './launch-brief.ts';
import { bypassingRls } from './outbox.ts';
import type { Actor, Archipelago } from './pelago.ts';

/** How a session is started: src/launcher.ts hands it in when it loads, since what it reads reaches back to the pack host. */
type Launch = (l: Archipelago, actor: Actor, input: LaunchInput, by?: StartedBy) => Promise<{ run: string; mode: LaunchMode }>;
let launch: Launch | undefined;
export const setPackLaunch = (fn: Launch) => void (launch = fn);

/** The event the kernel's clock tells packs when an item comes due. */
const ITEM_DUE = 'item.due';

/** A launch a pack asks for: as the automation that came due says it. */
export interface LaunchAsked {
  task: string;
  mode?: LaunchMode;
  instructions?: string;
}

/** The item a pack heard come due, when it was the kernel's own telling of it; else undefined. */
const dueOf = (input: unknown): string | undefined => {
  const e = (input as { event?: { action?: unknown; pack?: unknown; target?: unknown } } | null)?.event;
  return e?.action === ITEM_DUE && e.pack === 'kernel' && typeof e.target === 'string' && e.target ? e.target : undefined;
};

const text = (s: unknown) => (typeof s === 'string' ? s : '');

/**
 * Start what a pack asked to launch, having heard `input`: refused whole unless the kernel told it an enabled
 * automation came due and the launch is the one that automation says. Answers the run it started, or why it did not.
 */
export async function launchHeard(l: Archipelago, pack: string, input: unknown, asked: LaunchAsked): Promise<{ launched: boolean; run?: string; mode?: LaunchMode; why?: string }> {
  const id = dueOf(input);
  if (!id) throw new Error(`The ${pack} pack asks to launch: a pack launches only on hearing an automation come due (${ITEM_DUE}).`);
  const whole = await bypassingRls(l);
  const auto = await whole.entity(id);
  if (!auto || auto.archived_at || !whole.registry.isA(auto.type, 'automation')) throw new Error(`The ${pack} pack asks to launch for ${id}, which is not an automation.`);
  if (auto.status !== 'enabled') throw new Error(`The ${pack} pack asks to launch for "${auto.title}", which is not enabled.`);
  const p = auto.props;
  const problems = checkAutomation(p);
  if (problems.length) throw new Error(`"${auto.title}" cannot launch: ${problems.join('; ')}`);
  if (p.action !== 'launch') throw new Error(`"${auto.title}" does not launch a session.`);
  const said = (p.input ?? {}) as Record<string, unknown>;
  const mode = (said.mode as LaunchMode | undefined) ?? 'plan';
  if (asked?.task !== said.task || (asked.mode ?? 'plan') !== mode || text(asked.instructions) !== text(said.instructions))
    throw new Error(`The ${pack} pack asks to launch other than "${auto.title}" says: only its own task, mode and instructions.`);
  const last = typeof p.last_run === 'string' ? await whole.entity(p.last_run) : undefined;
  if (last?.is_open) return { launched: false, why: `the session it last started (${last.id}) is still open` };
  if (!launch) throw new Error('Launching is off on this server.');
  const started = await launch(whole, { kind: 'human', name: `automation:${auto.id}` }, { task: said.task as string, mode, instructions: text(said.instructions) || undefined }, { kind: 'automation', id: auto.id, name: auto.title });
  await whole.operational(auto.id, { props: { last_run: started.run } });
  return { launched: true, run: started.run, mode: started.mode };
}
