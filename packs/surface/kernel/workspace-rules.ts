// The working rules of one workspace: the rules file a project is handed (examples/working-rules.md), with what the
// map says at working_rules said in it, the owner's version of each over the packs' presets. The file handed out before
// any workspace is known (packs/loader/kernel/working-rules.ts) has only the presets; this is what a session on a map is
// told, so a rule the owner rewords on the map reaches it with no push.

import { callAs } from '../../loader/kernel/kernel-context.ts';
import { rulesFile } from '../../loader/kernel/working-rules.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';

/** The working rules file as this workspace says it, said to `run` when one is named. */
export async function workspaceRules(l: Archipelago, run?: string): Promise<string> {
  const { said } = await callAs<{ said: { title: string; text: string }[] }>(l, 'answer.instructions', { where: 'working_rules', ...(run && { run }) });
  return rulesFile(said);
}
