/**
 * The lean plugin's rules, pure: what a profile would leave out of Claude
 * Code's context, and how that is written into a project's settings.
 */
import type { UseRow } from "../used/tally.ts";
import { serverOf } from "../used/tally.ts";
import { reconcileJson, type Entry, type Ours as Shared } from "../project-files/entries.ts";

/** A profile needs this many runs before anything is left out: too few say nothing. */
export const MIN_RUNS = 5;

/** Never left out, used or not: what any session needs to read, change and find things, and the map's own server. */
export const KEEP_TOOLS = new Set(["Read", "Edit", "Write", "Bash", "PowerShell", "Glob", "Grep", "ToolSearch", "Skill", "Agent", "DeferredToolPlaceholder"]);
export const KEEP_SERVERS = new Set(["archipelago"]);

/** A name the lean plugin can leave out: `tool:<name>` or `mcp:<server>`, plain letters only. */
export const NAME = /^(tool:[A-Za-z0-9_-]+|mcp:[A-Za-z0-9_.-]+)$/;

/** Why a name may not be left out, or nothing: it may. */
export function kept(name: string): string | undefined {
  if (!NAME.test(name)) return `${name} is not tool:<name> or mcp:<server>.`;
  if (name.startsWith("tool:")) {
    const t = name.slice(5);
    if (KEEP_TOOLS.has(t)) return `${t} is always kept.`;
    const s = serverOf(t);
    if (s && KEEP_SERVERS.has(s)) return `The ${s} server's tools are always kept.`;
  } else if (KEEP_SERVERS.has(name.slice(4))) return `The ${name.slice(4)} server is always kept.`;
  return undefined;
}

export interface Leave {
  name: string;
  /** Runs it was given in, none of which used it. */
  given: number;
  size: number;
}

/**
 * What to leave out, from the profile's runs' rows: each MCP server none of
 * them used, then each tool none used that isn't a server's already left
 * out. Nothing with fewer than MIN_RUNS runs, and nothing kept().
 */
export function leaveOut(rows: UseRow[], runs: number): Leave[] {
  if (runs < MIN_RUNS) return [];
  const servers = new Set(rows.filter((r) => r.name.startsWith("mcp:") && r.used === 0 && !kept(r.name)).map((r) => r.name.slice(4)));
  const out: Leave[] = [];
  for (const r of rows) {
    if (r.used > 0 || r.given === 0 || kept(r.name)) continue;
    if (r.name.startsWith("tool:")) {
      const s = serverOf(r.name.slice(5));
      if (s && servers.has(s)) continue;
    }
    out.push({ name: r.name, given: r.given, size: r.size });
  }
  return out;
}

/** What a name puts into settings: a deny rule (a server's covers all its tools), and the server not started. */
export function entriesOf(name: string): { deny: string; server?: string } {
  if (name.startsWith("mcp:")) return { deny: `mcp__${name.slice(4)}`, server: name.slice(4) };
  return { deny: name.slice(5) };
}

/** What one settings file holds of ours, as lean says it. */
export interface Ours {
  deny: string[];
  servers: string[];
  /** The file was not there before: it goes when nothing of ours is left in it and nothing else is. */
  created?: boolean;
}

/** What is wanted, as entries of the shared writer (plugins/project-files): a deny rule, a server not started. */
export function leanEntries(w: { deny: string[]; servers: string[] }): Entry[] {
  return [...w.deny.map((item) => ({ at: ["permissions", "deny"], item })), ...w.servers.map((item) => ({ at: ["disabledMcpjsonServers"], item }))];
}

/** Entries back as lean says them. */
export function leanOurs(o: Shared): Ours {
  const of = (path: string) => o.entries.flatMap((e) => ("item" in e && e.at.join(".") === path && typeof e.item === "string" ? [e.item] : []));
  return { deny: of("permissions.deny"), servers: of("disabledMcpjsonServers"), ...(o.created ? { created: true } : {}) };
}

/**
 * A settings file brought to what is wanted of ours: entries in `want` and
 * not there are added (and become ours), ours not in `want` are taken out.
 * An entry the file had that isn't ours is never taken out. `text`
 * undefined: no file. Answers the new text (undefined: remove the file) and
 * what is ours now; `same` when nothing changes. The shared writer's rules
 * (plugins/project-files/entries.ts), said in lean's words.
 */
export function reconcile(text: string | undefined, had: Ours | undefined, want: { deny: string[]; servers: string[] }): { text?: string; ours: Ours; same: boolean } | { error: string } {
  const r = reconcileJson(text, had && { entries: leanEntries(had), ...(had.created ? { created: true } : {}) }, leanEntries(want));
  return "error" in r ? r : { ...r, ours: leanOurs(r.ours) };
}
