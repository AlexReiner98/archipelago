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
 * repository (the git plugin's `remote`). No credentials leave: only the host
 * and path.
 *
 * It adds `archipelago_transcript` too, for a server that can't open the
 * session's transcript (it runs elsewhere): the next page of it, read here
 * from a byte cursor kept per session, as numbers (`slim`): each record's
 * kind, time, sizes, tool names and token counts, never its text, a path or
 * an address. At most SEND_READ bytes a call, and a page that comes to more
 * than SEND_MAX is skipped and said so. The adapter says whether it wants
 * them (its `x-archipelago-transcript` answer: `send`, or `own` when it
 * reads the file itself); asked once, a session keeps that.
 *
 *   node plugins/claude-code/hook.ts [url]    (default http://127.0.0.1:5181/hook)
 *   node plugins/claude-code/hook.ts --map <name>
 *
 * With `--map`, the adapter is the named map's, found in the registry of
 * servers (registry.ts) at each call: a session follows its map to whatever
 * port it runs on, and while the map isn't running the hook says nothing.
 *
 * ARCHIPELAGO_HOOK_URL sets the url, ARCHIPELAGO_HOOK_TIMEOUT_MS how long to
 * wait for the answer (default 3000). ARCHIPELAGO_TOKEN, else the file
 * ARCHIPELAGO_TOKEN_FILE (default ~/.archipelago/token) when it is there,
 * goes as `Authorization: Bearer`, for a server that takes a token.
 *
 * Plain Node, no imports from the repository but slim.ts beside it (the
 * transcript as numbers): a server elsewhere serves the two (`/hook.ts`,
 * `/slim.ts`), and the transcript plugin reads records through the same `slim`.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Sent } from "./slim.ts";

/** slim.ts beside this script, when it is there: without it, the hook forwards as it always did. */
const slimmer = () => import("./slim.ts").catch(() => undefined);

const mapAt = process.argv.indexOf("--map");
/** The map named, when the hook reaches a map by name rather than an address. */
const map = mapAt >= 2 ? process.argv[mapAt + 1] : undefined;
const given = mapAt >= 2 ? undefined : (process.argv[2] ?? process.env.ARCHIPELAGO_HOOK_URL ?? "http://127.0.0.1:5181/hook");

/** The hook's address now: the one given, or the named map's adapter (registry.ts beside this script) while it runs. */
async function hookUrl(): Promise<string | undefined> {
  if (!map) return given;
  const registry = await import("./registry.ts").catch(() => undefined);
  const adapter = registry?.adapterOf(map);
  return adapter && `${adapter}/hook`;
}
const timeout = Number(process.env.ARCHIPELAGO_HOOK_TIMEOUT_MS) || 3000;

/** A remote url as `host/owner/name`: https, ssh and scp forms alike, no `.git`, no credentials. As the git plugin's normalRemote. */
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

const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

/** Where a session's cursor is kept, beside its lock: in the temp folder, by a hash, so a name tells nothing. */
export const cursorDir = () => process.env.ARCHIPELAGO_HOOK_STATE ?? join(tmpdir(), "archipelago-hook");
/** A lock older than this is taken over: a hook that died. */
const LOCK_MS = 15_000;

export interface Cursor {
  offset: number;
  /** The adapter's last answer: `own` stops the sending for this session. */
  answer?: string;
}

/**
 * The cursor for one run's transcript, held for the call: undefined while
 * another call of the same session holds it (that one sends; this one
 * doesn't wait).
 */
export function holdCursor(key: string, dir = cursorDir()): { cursor: Cursor; save(c: Cursor): void; release(): void } | undefined {
  const id = sha(key);
  const file = join(dir, `${id}.json`);
  const lock = join(dir, `${id}.lock`);
  try {
    mkdirSync(dir, { recursive: true });
    try {
      closeSync(openSync(lock, "wx"));
    } catch {
      if (Date.now() - statSync(lock).mtimeMs < LOCK_MS) return undefined;
      writeFileSync(lock, "");
    }
  } catch {
    return undefined;
  }
  let cursor: Cursor = { offset: 0 };
  try {
    const c = JSON.parse(readFileSync(file, "utf8")) as Cursor;
    if (typeof c.offset === "number" && c.offset >= 0) cursor = c;
  } catch {}
  return {
    cursor,
    save(c) {
      try {
        writeFileSync(`${file}.tmp`, JSON.stringify(c));
        renameSync(`${file}.tmp`, file);
      } catch {}
    },
    release() {
      rmSync(lock, { force: true });
    },
  };
}

/** The cursor after an answer: `own` stops sending; `send <bytes>` starts the next page where the server is; else after this page. */
export function nextCursor(was: Cursor, sent: Pick<Sent, "to">, answer: string | null): Cursor {
  if (answer === "own") return { offset: was.offset, answer };
  const at = /^send (\d+)$/.exec(answer ?? "");
  return { offset: at ? Number(at[1]) : sent.to, ...(answer ? { answer: "send" } : {}) };
}

/** The hook input with the next page of its transcript, when the adapter wants it; and what to do with the answer. */
export async function withTranscript(body: string, dir = cursorDir()): Promise<{ body: string; header?: string; answered(answer: string | null, ok: boolean): void }> {
  const none = { body, answered() {} };
  if (process.env.ARCHIPELAGO_TRANSCRIPT === "off") return none;
  const m = await slimmer();
  if (!m) return none;
  const { pageFrom, TRANSCRIPT_FIELD, TRANSCRIPT_HEADER, transcriptPath } = m;
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return none;
  }
  const sub = typeof input.agent_id === "string" && !!input.agent_id;
  const path = transcriptPath(input, sub);
  if (!path || typeof input.session_id !== "string") return none;
  const held = holdCursor(`${input.session_id}${sub ? `:${input.agent_id}` : ""}|${path}`, dir);
  if (!held) return none;
  const { cursor } = held;
  if (cursor.answer === "own") {
    held.release();
    return none;
  }
  try {
    // A file shorter than the cursor was begun again: send it from the start.
    let from = cursor.offset;
    try {
      if (statSync(path).size < from) from = 0;
    } catch {
      held.release();
      return none;
    }
    const sent = await pageFrom(path, from);
    if (!sent) {
      held.release();
      return none;
    }
    return {
      body: JSON.stringify({ ...input, [TRANSCRIPT_FIELD]: sent }),
      header: TRANSCRIPT_HEADER,
      answered(answer, ok) {
        // The server says how far it has the file (`send <bytes>`): the next page starts there, so a page that
        // didn't land, or a server that started again with nothing, is sent again. Without a word, on from this page.
        if (ok) held.save(nextCursor(cursor, sent, answer));
        held.release();
      },
    };
  } catch {
    held.release();
    return none;
  }
}

/** The token: the environment's, else the token file's when there is one. */
function tokenOf(): string | undefined {
  if (process.env.ARCHIPELAGO_TOKEN) return process.env.ARCHIPELAGO_TOKEN;
  try {
    return readFileSync(process.env.ARCHIPELAGO_TOKEN_FILE ?? join(homedir(), ".archipelago", "token"), "utf8").trim() || undefined;
  } catch {
    return undefined;
  }
}

if (import.meta.main) {
  let done: ((answer: string | null, ok: boolean) => void) | undefined;
  try {
    const url = await hookUrl();
    // The map isn't running: say nothing.
    if (!url) process.exit(0);
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    const sending = await withTranscript(withRemote(Buffer.concat(chunks).toString("utf8")));
    done = sending.answered;
    const token = tokenOf();
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: sending.body, signal: AbortSignal.timeout(timeout) });
    done(sending.header ? res.headers.get(sending.header) : null, res.ok);
    done = undefined;
    if (res.ok) process.stdout.write(await res.text());
  } catch {
    // The adapter is down or slow: say nothing.
    done?.(null, false);
  }
  process.exit(0);
}
