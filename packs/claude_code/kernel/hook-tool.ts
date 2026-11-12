// A session's hooks, called over MCP: report, action hook. A Claude Code plugin from the plugin directory runs no script
// (only Verified organizations may), so its hooks are mcp_tool hooks that call the map's own tools over the sign-in
// Claude Code already holds. The tool is declared here with its input as a JSON shape (packs/surface/kernel/
// tool-input.ts builds its schema) and run on the sessions pack's context, since this pack is a server pack (its
// adapter runs in the sandbox) and a pack with kernel code may have none: the root service root.hook answers it as
// POST /hooks/<surface>/<event> does, in the hook's own shape, with what only the server knows (its packs, its setup).

import { basename, dirname } from 'node:path';
import type { KernelContext } from '#pelago/kernel';

/** The server pack these hooks are: the one this module is part of, whose adapter (reach.server.adapter) names its surface. */
const PACK = basename(dirname(import.meta.dirname));

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
      session_id: 'string',
      'cwd?': 'string',
      'prompt?': 'string',
      'source?': 'string',
      'stop_hook_active?': 'any',
    },
    says: { stop_hook_active: 'As Claude Code passes it: true, or "true" when substituted into a string.' },
    run: (ctx, actor, input) => ctx.call('root.hook', { ...input, pack: PACK, within: actor.within ?? [], ...(actor.may && { may: actor.may }) }),
  },
};
