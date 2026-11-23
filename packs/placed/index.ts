/**
 * The placed pack: a profile's skills load only where they fit. A skill
 * node (the written pack's, with a `file` at `<…>/skills/<name>/SKILL.md`)
 * that some run doesn't hear (`profile.read`) is written into the folders
 * of the runs whose holding profiles hold it, as
 * `<cwd>/.claude/skills/<name>/SKILL.md`, and its own file (in the home
 * folder, where every session loads it) is taken away. It answers through
 * the written pack's `written.place`; the written pack does the writing and
 * undoes it when this pack unloads.
 *
 * - Folders are the `cwd`s of runs seen, with their facts (from the
 *   exchange's begin events). A folder that is gone is skipped.
 * - Nothing moves while no run is denied the skill: a profile in shadow
 *   denies nothing, so a skill stays home until a profile holding it is on.
 * - A run in no profile hears every node (fail open), but a file can't
 *   follow a run: such a folder gets no copy. The Context interface shows it.
 * - Each copy is kept out of git through the repository's own
 *   `info/exclude`, never its tracked .gitignore.
 *
 * Injects written.place, profile.read, exchange.read, exchange.watch and
 * agent.tree. Server only.
 */
import { execFile } from "node:child_process";
import { appendFile, readFile, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { AgentTree, RunInfo } from "../../spec/agent.ts";
import type { ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { ProfileRead } from "../../spec/profile.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { KEY, fold, type WrittenPlace } from "../written/place.ts";

export interface PlacedConfig {
  /** Runs git in a folder; replaced in tests. Nothing: not a repository. */
  git?: (cwd: string, args: string[]) => Promise<string | undefined>;
}

const realGit = (cwd: string, args: string[]) =>
  new Promise<string | undefined>((resolve) => {
    execFile("git", ["-C", cwd, ...args], { timeout: 3000, windowsHide: true }, (err, out) => resolve(err ? undefined : String(out).trim() || undefined));
  });

/** A skill's name from its SKILL.md path, or nothing. */
export function skillName(file: string): string | undefined {
  return /\/skills\/([^/]+)\/SKILL\.md$/i.exec(fold(file))?.[1];
}

const exists = async (dir: string) => {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
};

const placed: Pack<PlacedConfig> = {
  id: "placed",
  about: "Loads a profile's skills only where they apply.",
  inject: ["written.place", "profile.read", "exchange.read", "exchange.watch", "agent.tree"],
  async apply(ctx: Context, config: PlacedConfig = {}) {
    const git = config.git ?? realGit;
    const place = ctx.get<WrittenPlace>(KEY);
    const profiles = ctx.get<ProfileRead>("profile.read");
    const tree = ctx.get<AgentTree>("agent.tree");
    /** Each folder's latest run, with its facts. */
    const folders = new Map<string, RunInfo>();
    const seen = (run: RunInfo | undefined): boolean => {
      if (!run?.cwd || !run.facts) return false;
      const k = fold(run.cwd);
      const had = folders.get(k);
      folders.set(k, run);
      return !had || JSON.stringify(had.facts) !== JSON.stringify(run.facts);
    };
    const page = await ctx.get<ExchangeRead>("exchange.read").runs({ limit: LIMIT_MAX });
    for (const r of [...page.items].reverse()) seen(r);
    ctx.get<ExchangeWatch>("exchange.watch").watch({ kinds: ["begin"] }, (e) => {
      if (seen(e.detail as unknown as RunInfo)) place.changed();
    });
    profiles.watch(() => place.changed());

    /** Each copy kept out of git once, through the repository's info/exclude. */
    const ignored = new Set<string>();
    const ignore = async (cwd: string, name: string) => {
      const key = `${fold(cwd)}\n${name}`;
      if (ignored.has(key)) return;
      ignored.add(key);
      const path = await git(cwd, ["rev-parse", "--git-path", "info/exclude"]);
      if (!path) return;
      const file = isAbsolute(path) ? path : join(cwd, path);
      const line = `/.claude/skills/${name}/`;
      let text = "";
      try {
        text = await readFile(file, "utf8");
      } catch {}
      if (text.split(/\r?\n/).includes(line)) return;
      await appendFile(file, `${text && !text.endsWith("\n") ? "\n" : ""}${line}\n`, "utf8");
    };

    place.placer({
      name: "profiles",
      async files(item) {
        const name = typeof item.fields.file === "string" ? skillName(item.fields.file) : undefined;
        if (!name) return null;
        const node = tree.nodes().find((n) => n.source === item.id);
        if (!node) return null;
        const holds = new Map<string, boolean>();
        const holdsIt = async (profile: string) => {
          if (!holds.has(profile)) holds.set(profile, (await profiles.nodes(profile)).in.includes(node.id));
          return holds.get(profile)!;
        };
        let denied = false;
        const out: string[] = [];
        for (const run of folders.values()) {
          if (!(await exists(run.cwd!))) continue;
          const h = await profiles.hears(run, node);
          if (!h.hears) {
            denied = true;
            continue;
          }
          for (const p of await profiles.of(run)) {
            if (!p.holding || !(await holdsIt(p.id))) continue;
            out.push(join(run.cwd!, ".claude", "skills", name, "SKILL.md"));
            await ignore(run.cwd!, name);
            break;
          }
        }
        return denied ? out : null;
      },
    });
  },
};

export default placed;
