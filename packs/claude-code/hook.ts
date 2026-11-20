/**
 * A command hook that forwards to the adapter. Reads the hook input on
 * stdin, posts it to the adapter, prints the answer. If the adapter isn't
 * there, answers badly or is slow, it prints nothing and exits 0: a missing
 * map never stops the agent, and never shows as a hook error.
 *
 * Claude Code runs SessionStart only as a command; the user-level hooks
 * (README, "Every session") use this for every event, since an http hook to
 * a server that is down shows as an error.
 *
 * It adds `git_remote`: origin of the session's folder as host/owner/name,
 * read here, where the folder is, so a server elsewhere still knows the
 * repository (the git pack's `remote`). No credentials leave: only the host
 * and path.
 *
 *   node packs/claude-code/hook.ts [url]    (default http://127.0.0.1:5181/hook)
 *
 * ARCHIPELAGO_HOOK_URL sets the url, ARCHIPELAGO_HOOK_TIMEOUT_MS how long to
 * wait for the answer (default 3000).
 */
import { execFileSync } from "node:child_process";

const url = process.argv[2] ?? process.env.ARCHIPELAGO_HOOK_URL ?? "http://127.0.0.1:5181/hook";
const timeout = Number(process.env.ARCHIPELAGO_HOOK_TIMEOUT_MS) || 3000;

/** A remote url as `host/owner/name`: https, ssh and scp forms alike, no `.git`, no credentials. As the git pack's normalRemote. */
export function normalRemote(raw: string): string | undefined {
  const u = raw.trim();
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(u);
  let host: string;
  let path: string;
  if (scp) [host, path] = [scp[1]!, scp[2]!];
  else {
    try {
      const p = new URL(u);
      if (p.protocol === "file:") return undefined;
      [host, path] = [p.hostname, p.pathname];
    } catch {
      return undefined;
    }
  }
  path = path.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  return host && path ? `${host.toLowerCase()}/${path}` : undefined;
}

/** The hook input with `git_remote` added, when its folder has an origin. */
export function withRemote(body: string, git = (cwd: string) => execFileSync("git", ["-C", cwd, "remote", "get-url", "origin"], { encoding: "utf8", timeout: 1000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })): string {
  try {
    const input = JSON.parse(body) as Record<string, unknown>;
    if (typeof input.cwd !== "string" || !input.cwd || input.git_remote) return body;
    const remote = normalRemote(git(input.cwd));
    return remote ? JSON.stringify({ ...input, git_remote: remote }) : body;
  } catch {
    return body;
  }
}

if (import.meta.main) {
  try {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    const body = withRemote(Buffer.concat(chunks).toString("utf8"));
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(timeout) });
    if (res.ok) process.stdout.write(await res.text());
  } catch {
    // The adapter is down or slow: say nothing.
  }
  process.exit(0);
}
