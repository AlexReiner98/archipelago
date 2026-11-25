/**
 * Connecting this checkout's own sessions, for a client that can't be
 * started with `--settings` (the desktop app): the repository's hooks and
 * MCP server written into the files Claude Code reads for a project, kept
 * out of git, and taken out again leaving the files as they were. Plain data,
 * no I/O: scripts/connect.ts reads and writes, the tests check this.
 *
 * - `.claude/settings.local.json`: the hooks of plugins/claude-code/settings.json,
 *   beside any others, and `archipelago` in `enabledMcpjsonServers`, so it
 *   starts without a prompt.
 * - `.mcp.json`: the `archipelago` server of plugins/claude-code/mcp.json.
 * - `.git/info/exclude`: both, under a line that names this, so git status
 *   stays clean and nothing is committed.
 */

type Obj = { [key: string]: unknown };
type Hook = { type?: string; url?: string; command?: string };
type Group = { matcher?: string; hooks?: Hook[] };

export const NAME = "archipelago";
export const MARK = "# archipelago: npm run connect:here";
export const EXCLUDED = [".mcp.json", ".claude/settings.local.json"];

/** The files as they are, a missing one absent. */
export interface HereFiles {
  settings?: Obj;
  mcp?: Obj;
  exclude?: string;
}

/** A hook of Archipelago's own: one that posts to an adapter, or runs its hook script. */
export function ours(h: Hook): boolean {
  return (h.type === "http" && /^http:\/\/127\.0\.0\.1:\d+\/hook$/.test(h.url ?? "")) || (h.command ?? "").includes("plugins/claude-code/hook.ts");
}

/** The repository's settings and MCP config, moved from the dev adapter (5281) to `port` + 1. */
export function forPort<T>(value: T, port: number): T {
  return JSON.parse(JSON.stringify(value).replaceAll("127.0.0.1:5281/", `127.0.0.1:${port + 1}/`)) as T;
}

const groupsOf = (s: Obj | undefined) => ((s?.hooks ?? {}) as { [event: string]: Group[] });

/** Hooks without Archipelago's, an event with none left dropped. */
function without(hooks: { [event: string]: Group[] }): { [event: string]: Group[] } {
  const out: { [event: string]: Group[] } = {};
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = groups.map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !ours(h)) })).filter((g) => g.hooks.length);
    if (kept.length) out[event] = kept;
  }
  return out;
}

const tidy = (o: Obj): Obj | undefined => (Object.keys(o).length ? o : undefined);

/** The files with this checkout connected: Archipelago's hooks replaced, the rest kept. Run again, it changes nothing. */
export function connectHere(files: HereFiles, repo: { settings: Obj; mcp: Obj }): HereFiles {
  const hooks = without(groupsOf(files.settings));
  for (const [event, groups] of Object.entries(groupsOf(repo.settings))) hooks[event] = [...(hooks[event] ?? []), ...groups];
  const enabled = (files.settings?.enabledMcpjsonServers ?? []) as string[];
  const settings: Obj = { ...files.settings, hooks, enabledMcpjsonServers: enabled.includes(NAME) ? enabled : [...enabled, NAME] };
  const servers = (repo.mcp.mcpServers ?? {}) as Obj;
  const mcp: Obj = { ...files.mcp, mcpServers: { ...((files.mcp?.mcpServers ?? {}) as Obj), [NAME]: servers[NAME] } };
  const lines = (files.exclude ?? "").split(/\r?\n/);
  const exclude = lines.includes(MARK) ? files.exclude : `${(files.exclude ?? "").replace(/\n*$/, "")}${files.exclude?.trim() ? "\n" : ""}${[MARK, ...EXCLUDED].join("\n")}\n`;
  return { settings, mcp, exclude };
}

/** The files with this checkout disconnected: what connectHere added taken out, a file left empty gone (absent). */
export function disconnectHere(files: HereFiles): HereFiles {
  let settings: Obj | undefined;
  if (files.settings) {
    const { hooks: _h, enabledMcpjsonServers: en, ...rest } = files.settings;
    const hooks = without(groupsOf(files.settings));
    const enabled = ((en ?? []) as string[]).filter((n) => n !== NAME);
    settings = tidy({ ...rest, ...(Object.keys(hooks).length ? { hooks } : {}), ...(enabled.length ? { enabledMcpjsonServers: enabled } : {}) });
  }
  let mcp: Obj | undefined;
  if (files.mcp) {
    const { mcpServers, ...rest } = files.mcp;
    const { [NAME]: _gone, ...others } = (mcpServers ?? {}) as Obj;
    mcp = tidy({ ...rest, ...(Object.keys(others).length ? { mcpServers: others } : {}) });
  }
  let exclude = files.exclude;
  if (exclude !== undefined) {
    const lines = exclude.split(/\r?\n/);
    const at = lines.indexOf(MARK);
    if (at >= 0) {
      lines.splice(at, 1 + EXCLUDED.length);
      exclude = lines.join("\n");
    }
  }
  return { settings, mcp, exclude };
}
