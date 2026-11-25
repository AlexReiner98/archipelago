/**
 * The connect plugin, server side: how Claude Code reaches this map, for the
 * page to show a person who has no run yet (view.ts).
 *
 * - `connect.setup`: the MCP line and the hooks for this server (setup.ts).
 *   It writes nothing.
 * - `connect.token`, when config names a token action (`token`): makes a
 *   token for the person who asks, through that action, and hands it back
 *   once. Only a person may: an agent or a plugin is refused, so a token is
 *   only ever shown to whoever it is for. Nothing here keeps it.
 *
 * Config: `hook` and `mcp`, the adapter's urls as Claude Code reaches them;
 * `command`, how each hook runs (default: this checkout's
 * plugins/claude-code/hook.ts, with `hook`); `token`, the action that makes a
 * token (absent: the server takes none); `name`, the MCP server's name;
 * `save`, on a guest map, where the guest goes to keep it (the page then
 * shows a quiet "save"); `signin`, on a guest map, where someone with an
 * account goes to sign in instead (a quiet "sign in" beside it); `script`, where a hook script is served, so the
 * hooks are one command. `token` may be a path instead of an action: the
 * page then posts `{name}` to it on its own origin, with its cookie, and
 * gets `{name, token}` (a host's gateway that keeps the tokens).
 * Injects action.register.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import { Refused } from "../../spec/common.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { setup, type Setup } from "./setup.ts";

export interface ConnectConfig {
  hook?: string;
  mcp?: string;
  command?: string;
  token?: string;
  name?: string;
  save?: string;
  signin?: string;
  script?: string;
}

export const SETUP = "connect.setup";
export const MAKE_TOKEN = "connect.token";

/** This checkout's hook script, as a hook command for `hook`. */
export function localCommand(hook: string): string {
  const script = join(dirname(fileURLToPath(import.meta.url)), "..", "claude-code", "hook.ts").replaceAll("\\", "/");
  return `node "${script}" ${hook}`;
}

const connect: Plugin = {
  id: "connect",
  about: "How Claude Code reaches this map: the MCP line and the hooks, for a person to copy.",
  inject: ["action.register"],
  apply(ctx: Context, config: ConnectConfig = {}) {
    const register = ctx.get<ActionRegister>("action.register");
    const hook = config.hook ?? "http://127.0.0.1:5181/hook";
    const mcp = config.mcp ?? "http://127.0.0.1:5181/mcp";
    // A token is made by an action (an action name), or by the host in front (a path the page posts to).
    const tokenAt = config.token?.startsWith("/") ? config.token : undefined;
    const made: Setup = setup({ hook, mcp, command: config.command ?? localCommand(hook), token: !!config.token, name: config.name, save: config.save, signin: config.signin, script: config.script, tokenAt });

    register.register({
      name: SETUP,
      title: "How Claude Code reaches this map",
      doc: "The MCP line and the hooks for ~/.claude/settings.json. Where the server takes a token, they hold <token>.",
      input: { type: "object" },
      async run() {
        return made as unknown as Record<string, string>;
      },
    });

    const tokenAction = config.token;
    if (!tokenAction || tokenAt) return;
    register.register({
      name: MAKE_TOKEN,
      title: "Make a token for Claude Code",
      doc: "A new token for the person asking, shown once. A person only.",
      input: { type: "object", properties: { name: { type: "string" } } },
      async run(input: { name?: string }, call: ActionContext) {
        if (call.caller.actor?.kind !== "person") throw new Refused({ code: "person_only", message: "Only a person makes a token, for themselves.", by: { plugin: "connect" } });
        return call.call(tokenAction, { name: input.name ?? "claude-code" });
      },
    });
  },
};

export default connect;
