// A session's hooks, called over MCP: report, action hook. A Claude Code plugin from the plugin directory runs no script
// (only Verified organizations may), so its hooks are mcp_tool hooks that call the map's own tools over the sign-in
// Claude Code already holds. The tool is declared here with its input as a JSON shape (packs/surface/kernel/
// tool-input.ts builds its schema), filling the surface's slot surface.tools, and run on this pack's own context of the
// map it is called on: the root service root.hook answers it as POST /hooks/<surface>/<event> does, in the hook's own
// shape, with what only the server knows (its packs, its setup). The hooks are those of the server pack this one is
// named for (its id less `_hooks`: claude_code), whose adapter (reach.server.adapter) translates them.

import type { KernelContext } from '#pelago/kernel';

/** The server pack whose hooks these are: this pack's id less `_hooks`. */
const serverPack = (ctx: KernelContext) => ctx.pack.id.replace(/_hooks$/, '');

/** Who calls the tool, as the surface hands it: what its token writes within, and what it may do. */
interface Caller { within?: string[]; may?: string }

/** A tool as this pack declares it (the surface's DeclaredTool). */
interface Declared {
  description: string;
  input: Record<string, unknown>;
  says?: Record<string, string>;
  run(ctx: KernelContext, actor: Caller, input: Record<string, unknown>): Promise<unknown>;
}

export const HOOK_TOOLS: Record<string, Declared> = {
  hook: {
    description:
      'A Claude Code hook, called by an mcp_tool hook rather than by an agent: event (session-start, prompt, stop) and what Claude Code hands the hook (session_id, cwd, prompt, source, stop_hook_active). Answers in the hook’s own shape. A session not yet started is started at its first prompt.',
    input: {
      event: ['session-start', 'prompt', 'stop'],
      session_id: 'nonempty',
      'cwd?': 'string',
      'prompt?': 'string',
      'source?': 'string',
      'stop_hook_active?': ['boolean', 'string'],
    },
    says: { stop_hook_active: 'As Claude Code passes it: true, or "true" when substituted into a string.' },
    run: (ctx, actor, input) => ctx.call('root.hook', { ...input, pack: serverPack(ctx), within: actor.within ?? [], ...(actor.may && { may: actor.may }) }),
  },
};

/** surface.tools: the hook tool, declared to the surface. */
export const tools = () => HOOK_TOOLS;
