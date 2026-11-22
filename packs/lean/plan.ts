/**
 * The lean pack's rules, pure: what a profile would leave out of Claude
 * Code's context, and how that is written into a project's settings.
 */
import type { UseRow } from "../used/tally.ts";
import { serverOf } from "../used/tally.ts";

/** A profile needs this many runs before anything is left out: too few say nothing. */
export const MIN_RUNS = 5;

/** Never left out, used or not: what any session needs to read, change and find things, and the map's own server. */
export const KEEP_TOOLS = new Set(["Read", "Edit", "Write", "Bash", "PowerShell", "Glob", "Grep", "ToolSearch", "Skill", "Agent", "DeferredToolPlaceholder"]);
export const KEEP_SERVERS = new Set(["archipelago"]);

/** A name the lean pack can leave out: `tool:<name>` or `mcp:<server>`, plain letters only. */
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

/** What one settings file holds of ours. */
export interface Ours {
  deny: string[];
  servers: string[];
  /** The file was not there before: it goes when nothing of ours is left in it and nothing else is. */
  created?: boolean;
}

type Settings = Record<string, unknown> & { permissions?: Record<string, unknown> & { deny?: unknown }; disabledMcpjsonServers?: unknown };

const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * A settings file brought to what is wanted of ours: entries in `want` and
 * not there are added (and become ours), ours not in `want` are taken out.
 * An entry the file had that isn't ours is never taken out. `text`
 * undefined: no file. Answers the new text (undefined: remove the file) and
 * what is ours now; `same` when nothing changes.
 */
export function reconcile(text: string | undefined, had: Ours | undefined, want: { deny: string[]; servers: string[] }): { text?: string; ours: Ours; same: boolean } | { error: string } {
  let s: Settings = {};
  if (text !== undefined) {
    try {
      const v = JSON.parse(text) as unknown;
      if (!v || typeof v !== "object" || Array.isArray(v)) return { error: "it is not a JSON object" };
      s = v as Settings;
    } catch {
      return { error: "it is not JSON" };
    }
  }
  const ours: Ours = { deny: [...(had?.deny ?? [])], servers: [...(had?.servers ?? [])], ...(had?.created || (text === undefined && !had) ? { created: true } : {}) };
  let deny = list(s.permissions?.deny);
  let servers = list(s.disabledMcpjsonServers);
  const before = JSON.stringify([deny, servers]);
  // Ours no longer wanted: out. Ours the person took out by hand: no longer ours.
  ours.deny = ours.deny.filter((d) => deny.includes(d));
  ours.servers = ours.servers.filter((d) => servers.includes(d));
  deny = deny.filter((d) => want.deny.includes(d) || !ours.deny.includes(d));
  servers = servers.filter((d) => want.servers.includes(d) || !ours.servers.includes(d));
  ours.deny = ours.deny.filter((d) => want.deny.includes(d));
  ours.servers = ours.servers.filter((d) => want.servers.includes(d));
  for (const d of want.deny) if (!deny.includes(d)) deny.push(d), ours.deny.push(d);
  for (const d of want.servers) if (!servers.includes(d)) servers.push(d), ours.servers.push(d);
  if (JSON.stringify([deny, servers]) === before) return { ours, same: true, ...(text !== undefined ? { text } : {}) };
  const next: Settings = { ...s };
  const perms = { ...(s.permissions ?? {}) };
  if (deny.length) perms.deny = deny;
  else delete perms.deny;
  if (Object.keys(perms).length) next.permissions = perms;
  else delete next.permissions;
  if (servers.length) next.disabledMcpjsonServers = servers;
  else delete next.disabledMcpjsonServers;
  if (ours.created && !Object.keys(next).length) return { ours: { deny: [], servers: [], created: true }, same: false };
  return { text: JSON.stringify(next, null, 2) + "\n", ours, same: false };
}
