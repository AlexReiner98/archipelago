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
 * - `connect.here`, `connect.away`, `connect.folder`: a folder's Claude Code
 *   sessions connected to this map, as a `connection` item (folders.ts);
 *   the connect writer (write.ts) writes its files. Config `writes`, `home`,
 *   and `folder`, the checkout people work in (default this one).
 * Injects action.register, types.define and graph.read.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import { Refused } from "../../spec/common.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { FOLDER, setup, type Setup } from "./setup.ts";
import { folders, type FoldersConfig } from "./folders.ts";

export interface ConnectConfig extends FoldersConfig {
  hook?: string;
  mcp?: string;
  command?: string;
  token?: string;
  name?: string;
  save?: string;
  signin?: string;
  script?: string;
  /**
   * The checkout people work in: the folder `connect.here` connects when none
   * is named, and the one the empty map offers. Default the checkout this
   * server runs from; the live server runs from a worktree of its own at a
   * fixed commit, so `live:start` names the checkout it was set up from.
   */
  folder?: string;
  /** The map's name, when the server serves one by name: hooks and MCP then reach it by name, at any port. */
  map?: string;
}

export const SETUP = "connect.setup";
export const MAKE_TOKEN = "connect.token";

/** The checkout this server runs from: the folder `connect.here` connects when none is named. */
export const CHECKOUT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The checkout's own sessions and the adapter at `mcp`, on this machine:
 * its folder (connected from the page, `connect.here`), and where its
 * plugins/claude-code/mcp.json names `mcp` (the dev port), the terminal
 * command that writes nothing. None for an adapter elsewhere, or outside a
 * checkout.
 */
export function folderSession(mcp: string, root = CHECKOUT): { folder: string; session?: string } | undefined {
  const m = /^http:\/\/127\.0\.0\.1:(\d+)\/mcp$/.exec(mcp);
  if (!m) return undefined;
  let reaches: boolean;
  try {
    const file = JSON.parse(readFileSync(join(root, "plugins", "claude-code", "mcp.json"), "utf8")) as { mcpServers?: Record<string, { url?: string }> };
    reaches = Object.values(file.mcpServers ?? {}).some((s) => s.url === mcp);
  } catch {
    return undefined;
  }
  return { folder: root, ...(reaches ? { session: FOLDER } : {}) };
}

const besideAdapter = (file: string) => join(dirname(fileURLToPath(import.meta.url)), "..", "claude-code", file).replaceAll("\\", "/");

/** This checkout's hook script, as a hook command for `hook`; for a map served by name, for the map, whatever port it is on. */
export function localCommand(hook: string, map?: string): string {
  return map ? `node "${besideAdapter("hook.ts")}" --map ${map}` : `node "${besideAdapter("hook.ts")}" ${hook}`;
}

/** This checkout's MCP proxy (plugins/claude-code/proxy.ts), which finds a map's server by its name. */
export const proxyScript = () => besideAdapter("proxy.ts");

const connect: Plugin = {
  id: "connect",
  about: "How Claude Code reaches this map: the MCP line and the hooks, for a person to copy.",
  inject: ["action.register", "types.define", "graph.read"],
  apply(ctx: Context, config: ConnectConfig = {}) {
    const register = ctx.get<ActionRegister>("action.register");
    const hook = config.hook ?? "http://127.0.0.1:5181/hook";
    const mcp = config.mcp ?? "http://127.0.0.1:5181/mcp";
    // A token is made by an action (an action name), or by the host in front (a path the page posts to).
    const tokenAt = config.token?.startsWith("/") ? config.token : undefined;
    const made: Setup = setup({ hook, mcp, command: config.command ?? localCommand(hook, config.map), token: !!config.token, name: config.name, save: config.save, signin: config.signin, script: config.script, tokenAt });
    // Run from this checkout, with no token: its folder (the one people work in, when named), and a terminal session that changes nobody's settings.
    const checkout = config.folder ?? CHECKOUT;
    const own = !config.token && !config.script && !config.command ? folderSession(mcp) : undefined;
    const here = own && { ...own, folder: checkout };
    if (here) Object.assign(made, here);

    register.register({
      name: SETUP,
      title: "How Claude Code reaches this map",
      doc: "The MCP line and the hooks for ~/.claude/settings.json. Where the server takes a token, they hold <token>.",
      input: { type: "object" },
      async run() {
        return made as unknown as Record<string, string>;
      },
    });

    // A folder's sessions connected from the page, as an item on the map (folders.ts).
    folders(ctx, config, checkout);

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
