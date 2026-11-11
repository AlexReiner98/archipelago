// What a launched session is told and who it is started for: on this machine (src/launcher.ts).

import { askView } from './askview.ts';
import { needHuman } from './actor-checks.ts';
import type { Actor, Archipelago } from './pelago.ts';

/**
 * Who started a run, when it was not the owner: another person, an automation, or a delivery from outside (a push).
 * Such a run only proposes, whatever agents may do here: what it changes waits for the owner.
 */
export interface StartedBy {
  kind: 'person' | 'automation' | 'webhook' | 'pack';
  id?: string;
  name: string;
  /** A pack's action that started it (src/pack-action-launch.ts): the pack, and what else the pack says of the run. */
  pack?: string;
  [field: string]: unknown;
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
export async function briefFor(l: Archipelago, actor: Actor, input: LaunchInput, by?: StartedBy): Promise<{ brief: Brief; started?: StartedBy }> {
  needHuman(actor, 'Only a human can launch a session.');
  // Started by anyone but the owner (another member, or an automation), the session only proposes.
  const owner = await l.setting<string>('me');
  const started = by ?? (owner && actor.person && actor.person !== owner ? { kind: 'person' as const, id: actor.person, name: actor.name } : undefined);
  const brief = input.brief ?? ((await askView(l, actor, 'brief', { task: input.task })) as Brief);
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
