// A fixed replay set (task e_a2scax9j): a handful of real finished tasks, each with its brief frozen as it was, run
// again under a named pack version so two versions are compared on the same work. A replay launches each frozen brief
// through the launcher (src/launcher.ts), its run started by the set and naming the version, so its runs land in the
// measures beside the other version's.
//
// True replay under an old pack version waits on the log as the source of truth (e_jqck6rz6): nothing yet builds a
// registry from pack facts at a position. Until then a replay runs live, on a workspace that holds the version named
// (a canary), and is refused where the version in force is another.

import { z } from 'zod';
import { askView } from './askview.ts';
import { needHuman } from './actor-checks.ts';
import type { Brief } from './launch-brief.ts';
import { launch } from './launcher.ts';
import type { Actor, Archipelago } from './pelago.ts';
import type { Tool } from './tools.ts';

/** How many tasks a set holds: enough to judge a change on, few enough to run twice. */
export const SET_LEAST = 5;
export const SET_MOST = 10;
const SET_TYPE = 'replay_set';

/** One task of a set: its brief as it was when the set took it. */
export interface Frozen {
  task: string;
  title: string;
  brief: Brief;
  frozen_at: string;
}

async function setOf(l: Archipelago, id: string) {
  const set = await l.entity(id);
  if (!set || set.type !== SET_TYPE) throw new Error(`"${id}" is not a replay set.`);
  return set;
}

/**
 * Freeze the briefs of finished tasks onto a replay set, making the set when none is named. A task the set already
 * holds keeps the brief it was frozen with; the set holds five to ten when this is done.
 */
export async function freezeSet(l: Archipelago, actor: Actor, input: { set?: string; title?: string; tasks: string[] }) {
  const set = input.set ? await setOf(l, input.set) : undefined;
  if (!set && !input.title?.trim()) throw new Error('A new replay set needs a title.');
  const held = ((set?.props.tasks ?? []) as Frozen[]).slice();
  const at = new Date().toISOString();
  for (const id of [...new Set(input.tasks)]) {
    if (held.some((f) => f.task === id)) continue;
    const task = await l.entity(id);
    if (!task) throw new Error(`No task "${id}" on this map.`);
    if (task.is_open) throw new Error(`"${task.title}" is not finished: only finished work is replayed, so the two versions are judged on what was done.`);
    const brief = (await askView(l, actor, 'brief', { task: id })) as Brief;
    if (!brief.repo?.path) throw new Error(`"${task.title}" is not linked to a repository with a local path, so a replay has nowhere to run it.`);
    held.push({ task: id, title: task.title, brief, frozen_at: at });
  }
  if (held.length < SET_LEAST || held.length > SET_MOST) throw new Error(`A replay set holds ${SET_LEAST} to ${SET_MOST} tasks; this one would hold ${held.length}.`);
  const ops = set
    ? [{ op: 'update' as const, id: set.id, props: { tasks: held } }]
    : [{ op: 'create' as const, ref: 'set', type: SET_TYPE, title: input.title!.trim(), status: 'current', props: { tasks: held } }];
  const done = await l.change(actor, { ops, reason: `Froze ${held.length} briefs for a replay set` });
  const tasks = held.map((f) => ({ task: f.task, title: f.title, frozen_at: f.frozen_at }));
  if ('proposal' in done) return { status: done.status, proposal: done.proposal, held_by: done.held_by, tasks };
  return { set: set?.id ?? done.created.set, tasks };
}

/** The version in force here of a pack named <pack>@<version>, or why the replay cannot run under it. */
function inForce(l: Archipelago, version: string): string | undefined {
  const [pack, wanted] = version.split('@');
  if (!pack || !wanted) return `Name the version as <pack>@<version>, e.g. core@0.1.0, not "${version}".`;
  const here = l.registry.packs.find((p) => p.id === pack);
  if (!here) return `No pack "${pack}" is on here.`;
  if (here.version !== wanted) return `This map runs ${pack}@${here.version}, not ${wanted}: replay on a workspace that holds the version named.`;
  return undefined;
}

/** Launch every task of a set again from its frozen brief, under the pack version named, each run started by the set. */
export async function replaySet(l: Archipelago, actor: Actor, input: { set: string; version: string; mode?: 'plan' | 'acceptEdits'; instructions?: string }) {
  needHuman(actor, 'Only a human can replay a set: it launches sessions.');
  const set = await setOf(l, input.set);
  if (!set.is_open) throw new Error(`"${set.title}" is retired.`);
  const wrong = inForce(l, input.version);
  if (wrong) throw new Error(wrong);
  const tasks = (set.props.tasks ?? []) as Frozen[];
  if (tasks.length < SET_LEAST) throw new Error(`"${set.title}" holds ${tasks.length} tasks; a replay needs ${SET_LEAST} to ${SET_MOST}.`);
  const runs: { task: string; title: string; run?: string; problem?: string }[] = [];
  for (const f of tasks) {
    const by = { kind: 'replay' as const, id: set.id, name: `${set.title} (${input.version})`, version: input.version, task: f.task };
    try {
      const started = await launch(l, actor, { task: f.task, brief: f.brief, mode: input.mode, instructions: input.instructions }, by);
      runs.push({ task: f.task, title: f.title, run: started.run });
    } catch (err) {
      runs.push({ task: f.task, title: f.title, problem: (err as Error).message });
    }
  }
  return { set: set.id, version: input.version, runs };
}

export const REPLAY_TOOLS: Record<string, Tool> = {
  replay_freeze: {
    description:
      `Freeze the briefs of ${SET_LEAST} to ${SET_MOST} finished tasks onto a replay set (type replay_set), so they can be run again under another pack version and compared like with like. ` +
      'Names a set to add to, or a title for a new one. A task the set holds keeps the brief it was frozen with.',
    input: {
      set: z.string().optional().describe('The replay set to add to. Left out, a new one is made.'),
      title: z.string().max(60).optional().describe('A new set’s title.'),
      tasks: z.array(z.string()).min(1).max(SET_MOST).describe('Finished tasks, by id, each linked to a repository with a local path.'),
    },
    run: async (l, actor, input) => freezeSet(l, actor, input),
  },
  replay: {
    description:
      'Run every task of a replay set again from its frozen brief, each through a launch on this machine, under the pack version named (<pack>@<version>, the one this map runs). Each run is started by the set and names the version, so the runs of two versions are told apart.',
    humanOnly: true,
    input: {
      set: z.string(),
      version: z.string().describe('The pack version this replay is run under, as <pack>@<version>: refused when this map runs another.'),
      mode: z.enum(['plan', 'acceptEdits']).optional().describe('plan (default): read and investigate only. acceptEdits: may edit files in the repository.'),
      instructions: z.string().optional().describe('Anything to add to every brief.'),
    },
    run: async (l, actor, input) => replaySet(l, actor, input),
  },
};
