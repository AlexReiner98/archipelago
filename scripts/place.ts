/**
 * Whether a folder is somewhere that goes away: a map kept there is lost
 * with it. Pure, so scripts/live.ts and its test read the same rule.
 *
 * - under the system's temp folder;
 * - in a folder an app made for one session (a `scratch-workspaces` folder,
 *   as the Claude desktop app makes when a session starts with no folder);
 * - in a Claude Code session's own worktree (`.claude/worktrees/`), which is
 *   removed with the session.
 */
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

/** Why a folder won't last, or undefined when nothing says it won't. */
export function temporaryPlace(folder: string, temp = tmpdir()): string | undefined {
  const norm = (p: string) => resolve(p).replaceAll("\\", "/").toLowerCase();
  const at = norm(folder);
  const tmp = norm(temp);
  if (at === tmp || at.startsWith(`${tmp}/`)) return `it is in the system's temp folder (${temp})`;
  const parts = at.split("/");
  if (parts.includes("scratch-workspaces")) return "it is in a folder an app made for one session (scratch-workspaces), deleted with that session";
  const i = parts.indexOf(".claude");
  if (i >= 0 && parts[i + 1] === "worktrees") return "it is a Claude Code session's worktree (.claude/worktrees), removed with that session";
  return undefined;
}

/** The words a script prints when it refuses a temporary place. */
export function placeAdvice(folder: string, why: string): string {
  return [
    `refused: ${folder} won't last: ${why}.`,
    "A map that should last lives in a checkout of its own, in a folder you choose and keep:",
    `  git clone https://github.com/AlexReiner98/archipelago.git ${["<a folder you keep>", "archipelago"].join(sep === "\\" ? "\\" : "/")}`,
    "and live is set up from there (README, \"Set it up to keep\"). To go on here anyway: --here-anyway.",
  ].join("\n");
}
