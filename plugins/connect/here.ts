/**
 * A folder connected from the map: its Claude Code sessions report here,
 * from a terminal or the desktop app, which can't be started with
 * `--settings`. Plain data, no I/O: the `connection` type, and the entries
 * write.ts keeps in the folder's files while its connection is on.
 *
 * - `.claude/settings.local.json`: the hooks of plugins/claude-code/settings.json
 *   (pointed at this server's adapter, the hook script by its full path), and
 *   `archipelago` in `enabledMcpjsonServers`, so the server starts without a
 *   prompt.
 * - `.mcp.json`: the `archipelago` server, this server's `/mcp`.
 *
 * On a map served by name (`byMap`), the folder reports to the map, never a
 * port: every hook is the hook script with `--map <name>`, and the MCP server
 * is the proxy (plugins/claude-code/proxy.ts) with the name. Both find the
 * map's server in the registry on each call, so a session follows the map to
 * any port, and does nothing while it isn't running.
 * - git's exclude: both files, under a line that names this, so nothing is
 *   committed and git status stays clean.
 */
import type { Json } from "../../spec/common.ts";
import type { BaseDef } from "../../spec/types.ts";
import type { Entry } from "../project-files/entries.ts";

export const TYPE = "connection";
export const NAME = "archipelago";
export const MARK = "# archipelago: connected from the map (plugins/connect)";
export const SETTINGS = ".claude/settings.local.json";
export const MCP = ".mcp.json";

export const CONNECTION: BaseDef = {
  name: TYPE,
  doc: "A folder whose Claude Code sessions report to this map: while on, its settings hold the map's hooks and MCP server.",
  statuses: { open: ["on"], closed: ["off"] },
  fields: { folder: { kind: "text", doc: "The folder, as this server's machine names it." } },
};

type Hook = { type?: string; url?: string; command?: string; [k: string]: Json | undefined };
type Group = { matcher?: string; hooks?: Hook[] };

/** What a connected folder's files hold of ours: the repository's hooks and server, for this server's adapter. */
export function wanted(
  repo: { hooks?: Record<string, Group[]> },
  at: { hook: string; mcp: string; command: string; byMap?: { map: string; proxy: string } },
): { settings: Entry[]; mcp: Entry[]; exclude: Entry[] } {
  const settings: Entry[] = [];
  for (const [event, groups] of Object.entries(repo.hooks ?? {})) {
    for (const g of groups) {
      const hooks: Json[] = (g.hooks ?? []).map((h): Json => (h.type === "command" || at.byMap ? { type: "command", command: at.command } : { type: "http", url: at.hook }));
      settings.push({ at: ["hooks", event], item: { ...(g.matcher ? { matcher: g.matcher } : {}), hooks } });
    }
  }
  settings.push({ at: ["enabledMcpjsonServers"], item: NAME });
  return {
    settings,
    mcp: [{ at: ["mcpServers"], key: NAME, value: at.byMap ? { type: "stdio", command: "node", args: [at.byMap.proxy, at.byMap.map] } : { type: "http", url: at.mcp } }],
    exclude: [MARK, MCP, SETTINGS].map((line) => ({ line })),
  };
}
