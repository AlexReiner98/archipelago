// What a launched session is told and who it is started for: on this machine (src/launcher.ts, the surface's).
// Moved from src/launch-brief.ts; the old path adapts what took the map.

import type { KernelContext } from '#pelago/kernel';

/** Who asks: a person, an agent, a pack (src/pelago.ts, Actor). */
export interface Actor { kind: string; name: string; person?: string }

/** Who a run is started for, when it is not the owner (src/actor-checks.ts, StartedBy). */
export interface StartedBy {
  kind: 'person' | 'automation' | 'webhook' | 'pack';
  id?: string;
  name: string;
  pack?: string;
  [field: string]: unknown;
}

// Who a run is started for, and that one not the owner's only proposes, is an actor check (src/actor-checks.ts): the
// two it makes here are copied, small and pure, since a pack imports nothing of the kernel.
function startedFor(actor: { person?: string; name: string }, owner: string | undefined, by?: StartedBy): StartedBy | undefined {
  return by ?? (owner && actor.person && actor.person !== owner ? { kind: 'person', id: actor.person, name: actor.name } : undefined);
}
function needHuman(actor: { kind: string }, refusal: string): void {
  if (actor.kind !== 'human') throw new Error(refusal);
}

/** What the launched session may do without anyone there to approve it. */
export type LaunchMode = 'plan' | 'acceptEdits';

export interface LaunchInput {
  task: string;
  mode?: LaunchMode;
  instructions?: string;
  /** A brief held earlier (a replay set's): run as it was then, the task not worked on again. */
  brief?: Brief;
}

const MODE_NOTE: Record<LaunchMode, string> = {
  plan: 'You are running unattended in plan mode: you cannot edit files or run commands that change anything. Investigate, then reply with what you found and a concrete plan.',
  acceptEdits:
    'You are running unattended and may edit files in this repository. Do not commit, push or delete anything. Do not use a live application unless this brief says its resource is claimed for you. Finish with a summary of what you changed and what is left.',
};

export interface Brief {
  task: { id: string; title: string };
  repo?: { title: string; path?: string; address?: string };
  text: string;
}

/** The task's brief, and who the session is started for when it is not the owner (another member, or what `by` names). */
export async function briefFor(ctx: KernelContext, actor: Actor, input: LaunchInput, by?: StartedBy): Promise<{ brief: Brief; started?: StartedBy }> {
  needHuman(actor, 'Only a human can launch a session.');
  const started = startedFor(actor, ((await ctx.reads({ owner: true })) as string | null) ?? undefined, by);
  // The brief view, asked as the kernel asks a view (src/askview.ts): its answer is a lens preset's, whoever asks.
  const brief = input.brief ?? ((await ctx.reads({ view: 'brief', params: { task: input.task } })) as Brief);
  return { brief, started };
}

/** The prompt a launched session starts from: its brief, how it runs, and the owner's instructions. */
export const promptFor = (brief: Brief, mode: LaunchMode, run: string, instructions?: string, where = ''): string =>
  [
    brief.text,
    '',
    '## How you are running',
    MODE_NOTE[mode],
    ...(where ? [where] : []),
    `Your Archipelago run id is ${run}; it is already registered and will be closed for you. Use the pelago report tool, action session_update (run ${run}), for anything the owner should know along the way.`,
    instructions ? `\n## Instructions from the owner\n${instructions}` : '',
  ].join('\n');

/** The brief as a service (answer.launch_brief): the surface's launcher asks it by name. */
export const launchBrief = (ctx: KernelContext, input: { actor: Actor; input: LaunchInput; by?: StartedBy }) => briefFor(ctx, input.actor, input.input, input.by);

/** The prompt as a service (answer.launch_prompt), once the run is registered. */
export const launchPrompt = (_ctx: KernelContext, input: { brief: Brief; mode: LaunchMode; run: string; instructions?: string }) => promptFor(input.brief, input.mode, input.run, input.instructions);
