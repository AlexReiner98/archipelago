// Sessions started as the answer to a pack's action a person called (task e_bagaw58f; the refine pack's replay is the
// first). Beside packs/loader/kernel/pack-launch.ts, which starts what an automation says when it comes due, and changing nothing of
// it. Three guards keep it a power the owner sees and bounds (the coordinator, 11 Nov 2026):
// - declared: only a pack whose manifest asks for `reach.launch` may answer launches, and that shows in its reach on
//   the Packs screen before the owner adds it;
// - bounded: at most LAUNCHES_MOST in one answer (or fewer, as the pack declares), else refused whole;
// - proposes only: each is started on the calling person's authority, but its run names the pack (started_by kind
//   pack), so the session's token only proposes, as an automation's does.
// Asked by an agent, or by anything but an action, it is refused whole, before anything is written or started.

import type { Brief, LaunchInput, LaunchMode, StartedBy } from '../../agents/kernel/launch-brief.ts';
import type { ActionDef } from './declared.ts';
import type { Manifest } from './manifest.ts';
import type { Actor, Archipelago } from '../../write/kernel/pelago.ts';

/** How a session is started: packs/surface/kernel/launcher.ts hands it in when it loads, since what it reads reaches back to the pack host. */
type Launch = (l: Archipelago, actor: Actor, input: LaunchInput, by?: StartedBy) => Promise<{ run: string; mode: LaunchMode }>;
let launch: Launch | undefined;
export const setActionLaunch = (fn: Launch) => void (launch = fn);

/** The most sessions one answer may start. */
export const LAUNCHES_MOST = 10;

/** One session a pack's action asks to start. */
export interface LaunchesAsked {
  task: string;
  mode?: LaunchMode;
  instructions?: string;
  /** A brief it holds, run as it is in place of the task's brief now; the run is then tied to no task. */
  brief?: Brief;
  /** What its run names it was started by: the item it is for (id), a name, and the pack's own fields. */
  by?: { id?: string; name?: string } & Record<string, unknown>;
}

/** How many sessions a pack's manifest lets one answer start: none unless it asks for reach.launch. */
export const launchesAllowed = (m: Pick<Manifest, 'reach'>): number => {
  const said = m.reach?.launch;
  if (said === true) return LAUNCHES_MOST;
  return typeof said === 'number' && Number.isInteger(said) && said > 0 ? Math.min(said, LAUNCHES_MOST) : 0;
};

/** Why these launches are refused, or undefined when they may start. */
export function launchesRefused(file: Manifest, actor: Actor, action: ActionDef | undefined, list: unknown): string | undefined {
  if (!action) return `The ${file.id} pack asks to launch sessions: only an action a person calls may.`;
  if (actor.kind !== 'human') return `The ${file.id} pack asks to launch sessions: only a person calling its action may have it start them, not an agent.`;
  const most = launchesAllowed(file);
  if (!most) return `The ${file.id} pack asks to launch sessions, and its manifest does not ask for reach.launch.`;
  if (!Array.isArray(list) || !list.length) return `The ${file.id} pack's launches are a list of sessions.`;
  if (list.length > most) return `The ${file.id} pack asks to launch ${list.length} sessions in one answer; it may start ${most} at most.`;
  const wrong = list.findIndex((x) => !x || typeof (x as LaunchesAsked).task !== 'string' || !(x as LaunchesAsked).task);
  if (wrong >= 0) return `The ${file.id} pack's launch ${wrong + 1} names no task.`;
  return undefined;
}

/** Start each session the action asked for, as the person who called it; each run names the pack. Refused whole first. */
export async function launchesAsked(l: Archipelago, file: Manifest, actor: Actor, action: ActionDef | undefined, list: LaunchesAsked[]) {
  const why = launchesRefused(file, actor, action, list);
  if (why) throw new Error(why);
  if (!launch) throw new Error('Launching is off on this server.');
  const runs: { task: string; run?: string; problem?: string }[] = [];
  for (const asked of list) {
    const { id, name, ...fields } = asked.by ?? {};
    const by: StartedBy = { ...fields, kind: 'pack', pack: file.id, ...(typeof id === 'string' && { id }), name: typeof name === 'string' && name ? name : file.title };
    try {
      const started = await launch(l, actor, { task: asked.task, mode: asked.mode, instructions: asked.instructions, brief: asked.brief }, by);
      runs.push({ task: asked.task, run: started.run });
    } catch (err) {
      runs.push({ task: asked.task, problem: (err as Error).message });
    }
  }
  return runs;
}
