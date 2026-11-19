// The working rules of one workspace: the rules file a project is handed (examples/working-rules.md), with what the
// map says at working_rules said in it, the owner's version of each over the packs' presets. The file handed out before
// any workspace is known (packs/loader/kernel/working-rules.ts) has only the presets; this is what a session on a map is
// told, so a rule the owner rewords on the map reaches it with no push.

import { callAs } from '../../loader/kernel/kernel-context.ts';
import { rulesFile } from '../../loader/kernel/working-rules.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';
import type { RootCall } from '../../loader/kernel/root-calls.ts';

/** The working rules file as this workspace says it, said to `run` when one is named. */
export async function workspaceRules(l: Archipelago, run?: string): Promise<string> {
  const { said } = await callAs<{ said: { title: string; text: string }[] }>(l, 'answer.instructions', { where: 'working_rules', ...(run && { run }) });
  return rulesFile(said);
}

/**
 * root.rules_file: the working rules file of the calling map, as its .claude/pelago.md is written from the map (the
 * agents pack's written files, `written:.claude/pelago.md`), said to `run` when one is named.
 */
export async function rulesFileOf(call: RootCall, input: { run?: string }): Promise<{ text: string }> {
  if (!call.map) throw new Error('root.rules_file answers a map: call it from one');
  return { text: await workspaceRules(call.map, typeof input?.run === 'string' && input.run ? input.run : undefined) };
}
