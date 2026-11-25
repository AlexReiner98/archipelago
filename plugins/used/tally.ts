/**
 * The used plugin's rules, pure: from what each run was given (its transcript's
 * `tool:<name>` and `mcp:<server>` nodes, with their size) and what it used
 * (its tool acts), a row per tool and per MCP server: in how many runs it
 * was given, in how many used, and its size.
 */

/** One run: the given tool and server nodes by name, with their size in letters; the tools it called, by name. */
export interface RunUse {
  run: string;
  given: Map<string, number>;
  used: Set<string>;
}

/** A tool (`tool:<name>`) or an MCP server (`mcp:<server>`) across runs. */
export interface UseRow {
  name: string;
  /** Runs it was given in (a tool called counts as given). */
  given: number;
  /** Runs that called it, or, for a server, one of its tools. */
  used: number;
  /** Letters, in the newest run that was given it: a server's tools and its instructions together. */
  size: number;
}

/** The MCP server a tool belongs to (`mcp__<server>__<tool>`), or nothing: Claude Code's own. */
export function serverOf(tool: string): string | undefined {
  const m = /^mcp__(.+?)__.+$/.exec(tool);
  return m?.[1];
}

/** Whether a given node's name is one this plugin counts: a tool's definition or a server's instructions. */
export const counted = (name: string) => name.startsWith("tool:") || name.startsWith("mcp:");

/** The rows, by name; `runs` newest first, so a size is the newest run's. */
export function tally(runs: RunUse[]): UseRow[] {
  const rows = new Map<string, UseRow>();
  const row = (name: string) => rows.get(name) ?? (rows.set(name, { name, given: 0, used: 0, size: -1 }), rows.get(name)!);
  for (const r of runs) {
    const tools = new Map<string, number>();
    for (const [name, size] of r.given) if (name.startsWith("tool:")) tools.set(name.slice(5), size);
    for (const t of r.used) if (!tools.has(t)) tools.set(t, 0);
    const servers = new Map<string, { size: number; used: boolean }>();
    for (const [name, size] of r.given) if (name.startsWith("mcp:")) servers.set(name.slice(4), { size, used: false });
    for (const [t, size] of tools) {
      const x = row(`tool:${t}`);
      x.given++;
      if (r.used.has(t)) x.used++;
      if (x.size < 0 && r.given.has(`tool:${t}`)) x.size = size;
      const s = serverOf(t);
      if (!s) continue;
      const sv = servers.get(s) ?? (servers.set(s, { size: 0, used: false }), servers.get(s)!);
      sv.size += size;
      if (r.used.has(t)) sv.used = true;
    }
    for (const [s, sv] of servers) {
      const x = row(`mcp:${s}`);
      x.given++;
      if (sv.used) x.used++;
      if (x.size < 0) x.size = sv.size;
    }
  }
  return [...rows.values()].map((x) => ({ ...x, size: Math.max(0, x.size) })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
