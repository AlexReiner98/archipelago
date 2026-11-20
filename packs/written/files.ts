/**
 * Which files the written pack may adopt and write, and the place each is
 * said at. Pure but for reading folders: the places are the ones the Claude
 * Code adapter reaches when the harness loads the file (packs/claude-code
 * mapping.ts, `loadsIn`), so the map's node is the one said there.
 *
 * | File | Place |
 * |---|---|
 * | `<…>/skills/<name>/SKILL.md` | `skill:<name>`, `skill:<plugin>:<name>` inside a plugin |
 * | `~/.claude/CLAUDE.md` | `memory:user/~/.claude/CLAUDE.md` |
 * | `<…>/CLAUDE.md` | `memory:project/<path>` |
 * | `<…>/CLAUDE.local.md` | `memory:local/<path>` |
 * | `~/.claude/projects/<p>/memory/MEMORY.md` | `memory:auto/<path>` |
 *
 * Nothing else: settings, hooks and permissions decide what an agent may run
 * unasked, and are never written from the map.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** What the old map (the archipelago repository's hook) puts at the head of a file it writes: such a file is its own. */
export const OLD_MARK = "<!-- Written from the map";

export interface Found {
  /** The file, as the system names it. */
  file: string;
  place: string;
  kind: "skill" | "memory";
  title: string;
}

const slash = (p: string) => p.replaceAll("\\", "/");
const fold = (s: string) => (/^[a-z]:\//i.test(s) ? s.toLowerCase() : s);

/** A path with `/`, and `~` for the home folder: as a `memory:` place writes it. */
export function homePath(path: string, home?: string): string {
  const p = slash(path);
  if (!home) return p;
  const h = slash(home).replace(/\/+$/, "");
  return fold(p).startsWith(fold(h) + "/") ? `~${p.slice(h.length)}` : p;
}

/** A plugin's name from the nearest `.claude-plugin/plugin.json` above a skill's folder, if it is in one. */
async function pluginOf(skillDir: string): Promise<string | undefined> {
  let dir = dirname(dirname(skillDir));
  for (let i = 0; i < 3; i++) {
    try {
      const json = JSON.parse(await readFile(join(dir, ".claude-plugin", "plugin.json"), "utf8"));
      if (typeof json?.name === "string" && json.name) return json.name;
    } catch {}
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return undefined;
}

/** The place a file is said at, or why it isn't one the map may write. */
export async function placeOf(file: string, home?: string): Promise<Found | { file: string; why: string }> {
  let path = file;
  try {
    if ((await stat(path)).isDirectory()) path = join(path, "SKILL.md");
  } catch {}
  const name = basename(path);
  const p = slash(path);
  if (name === "SKILL.md") {
    const dir = dirname(path);
    const skill = basename(dir);
    if (basename(dirname(dir)) !== "skills") return { file, why: "A skill is <…>/skills/<name>/SKILL.md." };
    const plugin = await pluginOf(dir);
    const full = plugin ? `${plugin}:${skill}` : skill;
    return { file: path, place: `skill:${full}`, kind: "skill", title: `skill ${full}` };
  }
  const at = homePath(path, home);
  const scope =
    name === "CLAUDE.local.md"
      ? "local"
      : name === "MEMORY.md" && /\/\.claude\/projects\/[^/]+\/memory\/MEMORY\.md$/.test(p)
        ? "auto"
        : name === "CLAUDE.md"
          ? home && fold(p) === fold(slash(join(home, ".claude", "CLAUDE.md")))
            ? "user"
            : "project"
          : undefined;
  if (!scope) return { file, why: "Only SKILL.md, CLAUDE.md, CLAUDE.local.md and MEMORY.md are written from the map." };
  return { file: path, place: `memory:${scope}/${at}`, kind: "memory", title: `${scope} memory ${at}` };
}

/** Claude Code's folder for a project's auto memory: the path with every other character a `-`. */
export const projectSlug = (project: string) => project.replace(/[^a-zA-Z0-9]/g, "-");

const exists = async (f: string) => {
  try {
    return (await stat(f)).isFile();
  } catch {
    return false;
  }
};

async function skillsIn(dir: string): Promise<string[]> {
  let names: string[] = [];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const n of names.sort()) if (await exists(join(dir, n, "SKILL.md"))) out.push(join(dir, n, "SKILL.md"));
  return out;
}

/** Every `skills/<name>/SKILL.md` under a folder, a few levels down (a plugin cache's marketplace/plugin/version). */
async function skillsBelow(dir: string, depth: number): Promise<string[]> {
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory() || e.name === "node_modules" || e.name.startsWith(".")) continue;
    if (e.name === "skills") out.push(...(await skillsIn(join(dir, e.name))));
    else if (depth > 0) out.push(...(await skillsBelow(join(dir, e.name), depth - 1)));
  }
  return out;
}

export interface Scan {
  /** The user's own: `~/.claude/skills/*`, `~/.claude/CLAUDE.md`. */
  user?: boolean;
  /** Installed plugins' skills, under `~/.claude/plugins`. */
  plugins?: boolean;
  /** A project folder: its CLAUDE.md, CLAUDE.local.md, `.claude/skills/*`, and its auto memory's MEMORY.md. */
  project?: string;
}

/** The files a scan finds, each once by place (the first found wins). */
export async function discover(scan: Scan, home: string): Promise<string[]> {
  const files: string[] = [];
  if (scan.user) {
    files.push(...(await skillsIn(join(home, ".claude", "skills"))));
    files.push(join(home, ".claude", "CLAUDE.md"));
  }
  if (scan.plugins) files.push(...(await skillsBelow(join(home, ".claude", "plugins"), 5)));
  if (scan.project) {
    const p = scan.project;
    files.push(join(p, "CLAUDE.md"), join(p, ".claude", "CLAUDE.md"), join(p, "CLAUDE.local.md"));
    files.push(...(await skillsIn(join(p, ".claude", "skills"))));
    files.push(join(home, ".claude", "projects", projectSlug(p), "memory", "MEMORY.md"));
  }
  const out: string[] = [];
  for (const f of files) if (await exists(f)) out.push(f);
  return out;
}
