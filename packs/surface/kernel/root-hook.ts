// root.hook, for the claude_code pack (docs/kernel-packs.md, "Root services"): a session's hook called over MCP
// (report, action hook), answered as POST /hooks/<surface>/<event> answers it (the loader's answerAt), in the hook's
// own shape. A Claude Code plugin from the plugin directory runs no script, so its hooks are mcp_tool hooks that call
// the map's own tools over the sign-in Claude Code already holds; Claude Code runs no mcp_tool hook at launch (it has no
// MCP client yet), so a session it has not heard of is started at its first prompt. What only the server knows (its
// packs, the code it runs, its setup's version, the working rules it hands out) is held here, set when it starts.

import type { RootCall } from '../../loader/kernel/root-calls.ts';
import type { ServerPacks } from './server-host.ts';
import { answerAt } from '../../loader/kernel/server-adapter.ts';
import { shippedRules } from '../../loader/kernel/working-rules.ts';
import { setupVersion } from './server-files.ts';
import { runsRead } from './packreads-runs.ts';

let reach: { packs: ServerPacks; running: { commit?: string; started: string } } | undefined;
/** The server's packs and the code it runs, set by the server: a hook is answered by the same adapter as /hooks/. */
export function configureHookTool(packs: ServerPacks, running: { commit?: string; started: string }): void {
  reach = { packs, running };
}

type Told = { hookSpecificOutput?: { hookEventName?: string; additionalContext?: string } } & Record<string, unknown>;

/** Answers to one hook (the working rules, the start, the prompt) as one, their words one after the other. */
const joined = (hookEventName: string, ...answers: Told[]): Told => {
  const words = answers.map((a) => a.hookSpecificOutput?.additionalContext).filter(Boolean).join('\n\n');
  const all = Object.assign({}, ...answers) as Told;
  return words ? { ...all, hookSpecificOutput: { hookEventName, additionalContext: words } } : all;
};
/** The working rules a session is handed as it starts: no file of the plugin's is read, since no script runs. */
const rules = (): Told => ({ hookSpecificOutput: { additionalContext: shippedRules() } });

/** What the hook tool hands: the event, what Claude Code hands the hook, and what the token may do. */
export interface HookAsk {
  /** The server pack whose hooks these are: its adapter (reach.server.adapter) names the surface. */
  pack: string;
  event: 'session-start' | 'prompt' | 'stop';
  session_id: string;
  cwd?: string;
  prompt?: string;
  source?: string;
  stop_hook_active?: boolean | string;
  within?: string[];
  may?: string;
}

/** One hook answered on the calling map, in the hook's own shape; nothing where this server translates no such surface. */
export async function hookAnswer(call: RootCall, input: HookAsk): Promise<Told> {
  const l = call.map;
  if (!l) throw new Error('root.hook answers a hook on a map: call it from one');
  if (typeof input.session_id !== 'string' || !input.session_id) throw new Error('A hook names its session: session_id');
  if (!reach) return {};
  const { packs, running } = reach;
  // The surface whose hooks these are: the pack's, as its adapter translates them. Without it there is no answer, as before.
  const surface = packs.packs.find((p) => p.file.id === input.pack)?.file.reach.server.adapter?.surface;
  if (!surface) return {};
  // A plugin keeps no files in the project, so none can be behind: it says it has the server's own.
  const setup = setupVersion();
  const body = {
    session_id: input.session_id,
    ...(setup && { setup }),
    ...(input.cwd && { cwd: input.cwd }),
    ...(input.prompt !== undefined && { prompt: input.prompt }),
    ...(input.source && { source: input.source }),
    ...(input.stop_hook_active !== undefined && { stop_hook_active: input.stop_hook_active === true || input.stop_hook_active === 'true' }),
  };
  const answer = async (event: string, said: object) =>
    ((await answerAt(packs, surface, event, { pelago: l, within: input.within ?? [], may: input.may as never, body: said, running, origin: packs.origin ?? '' })) ?? {}) as Told;
  // A session not yet started is started at its first prompt: the map has no run by its session id.
  const known = Boolean(await runsRead(l, { run_of: { key: input.session_id } }));
  if (input.event === 'prompt' && !known) return joined('UserPromptSubmit', rules(), await answer('session-start', { ...body, source: 'startup' }), await answer('prompt', body));
  if (input.event === 'session-start') return joined('SessionStart', rules(), await answer('session-start', body));
  return answer(input.event, body);
}
