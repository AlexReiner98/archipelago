// A session's hooks, called over MCP: report, action hook. A Claude Code plugin from the plugin directory runs no script
// (only Verified organizations may), so its hooks are mcp_tool hooks that call the map's own tools over the sign-in
// Claude Code already holds. This answers one as POST /hooks/claude_code/<event> does (src/server-adapter.ts), in the
// hook's own shape. Claude Code runs no mcp_tool hook at launch (it has no MCP client yet), so a session it has not
// heard of is started at its first prompt.

import { z } from 'zod';
import type { ServerPacks } from './server-host.ts';
import type { Tool } from './tools.ts';

/** The surface whose hooks these are: Claude Code's, as its server pack translates them. */
const SURFACE = 'claude_code';

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
const rules = async (): Promise<Told> => ({ hookSpecificOutput: { additionalContext: (await import('./working-rules.ts')).shippedRules() } });

export const HOOK_TOOLS: Record<string, Tool> = {
  hook: {
    description:
      'A Claude Code hook, called by an mcp_tool hook rather than by an agent: event (session-start, prompt, stop) and what Claude Code hands the hook (session_id, cwd, prompt, source, stop_hook_active). Answers in the hook’s own shape. A session not yet started is started at its first prompt.',
    input: {
      event: z.enum(['session-start', 'prompt', 'stop']),
      session_id: z.string().min(1),
      cwd: z.string().optional(),
      prompt: z.string().optional(),
      source: z.string().optional(),
      stop_hook_active: z.union([z.boolean(), z.string()]).optional().describe('As Claude Code passes it: true, or "true" when substituted into a string.'),
    },
    run: async (l, actor, input) => {
      if (!reach) return {};
      const { packs, running } = reach;
      const { answerAt } = await import('./server-adapter.ts');
      const { resolveRun } = await import('./chat-run.ts');
      const { wholeMap } = await import('./outbox.ts');
      const { db } = await wholeMap(l);
      // A plugin keeps no files in the project, so none can be behind: it says it has the server's own.
      const setup = (await import('./server-files.ts')).setupVersion();
      const body = {
        session_id: input.session_id,
        ...(setup && { setup }),
        ...(input.cwd && { cwd: input.cwd }),
        ...(input.prompt !== undefined && { prompt: input.prompt }),
        ...(input.source && { source: input.source }),
        ...(input.stop_hook_active !== undefined && { stop_hook_active: input.stop_hook_active === true || input.stop_hook_active === 'true' }),
      };
      const answer = async (event: string, said: object) =>
        ((await answerAt(packs, SURFACE, event, { whole: db, pelago: l, within: actor.within ?? [], may: actor.may, body: said, running, origin: packs.origin ?? '' })) ?? {}) as Told;
      if (input.event === 'prompt' && !(await resolveRun(l, input.session_id))) return joined('UserPromptSubmit', await rules(), await answer('session-start', { ...body, source: 'startup' }), await answer('prompt', body));
      if (input.event === 'session-start') return joined('SessionStart', await rules(), await answer('session-start', body));
      return answer(input.event, body);
    },
  },
};
