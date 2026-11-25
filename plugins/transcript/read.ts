/**
 * Reading Claude Code's transcript, as pure parts: a page of lines from a
 * byte cursor, and an index of what the agent was given, built record by
 * record. The index keeps places, names and where each text is in the file
 * (a line's offset and length, and which part of it), never the text: the
 * text is read again from the file when it is asked for.
 *
 * The transcript's format is Claude Code's own, undocumented and internal
 * to its version. A record of a kind this doesn't know is skipped, and so
 * is a line that isn't JSON.
 */
import { open } from "node:fs/promises";
import type { Place } from "../../spec/agent.ts";
import { slim, type Line, type Slim } from "../claude-code/slim.ts";
import { TalkIndex } from "./talk.ts";
import { TokenIndex } from "./tokens.ts";

export * from "./tokens.ts";
// Reading a page, a record as numbers, who a hook is: the hook carries them (plugins/claude-code/slim.ts).
export { hookWho, isOurs, LINE_MAX, PAGE_BYTES, readPage, slim, type Line, type Slim } from "../claude-code/slim.ts";

/** The most text one node answers with. */
export const TEXT_MAX = 200_000;

/** One line again, by where the index put it. */
export async function readLine(path: string, at: { offset: number; length: number }): Promise<string | undefined> {
  let file;
  try {
    file = await open(path, "r");
  } catch {
    return undefined;
  }
  try {
    const buf = Buffer.alloc(at.length);
    const { bytesRead } = await file.read(buf, 0, at.length, at.offset);
    return buf.subarray(0, bytesRead).toString("utf8");
  } finally {
    await file.close();
  }
}

// ---------- what the agent was given ----------

/** Which part of a line a node's text is. */
export type Pick =
  | { part: "system" }
  | { part: "tool"; name: string }
  | { part: "mcp"; server: string }
  | { part: "listing" }
  | { part: "lines" }
  | { part: "model" }
  | { part: "hook"; index: number };

export interface Spot {
  offset: number;
  length: number;
  pick: Pick;
}

/** A node of what the agent was given, without its text. */
export interface Given {
  /** Stable within the run: `system`, `tool:<name>`, `mcp:<server>`, `skills`, `agents`, `deferred`, `model`, `hook:<place>:<who>`. */
  name: string;
  title: string;
  /** Who said it: Claude Code, an MCP server, a hook. */
  by: string;
  at: Place;
  /** How many times it was given. */
  count: number;
  /** Tokens, for what is there from the start: characters / 4, scaled to the first real input (index.ts). */
  tokens?: number;
  /** Of them, fitted to the model's real counts. */
  fitted?: number;
  /** About how long its text is, in characters. */
  size: number;
  /** When it was first and last given: the transcript's own times, when it has them. */
  first?: string;
  last?: string;
}

interface Entry extends Given {
  spots: Spot[];
  /** Hook texts by their hash, so the same words given again count once. */
  seen?: Set<string>;
}

/** Who said it, when Claude Code itself did. */
export const CLAUDE_CODE = "Claude Code";

/** The session's own context (the account, its email, git status, folders): never indexed, never shown. */
export const PRIVATE = ["session_context", "environment", "credential_org"];

/** How many times one node's givings are kept, for its history; the oldest drop off. */
export const PIECES_MAX = 5000;

/** How many places one hook node keeps texts from; older ones drop off. */
const SPOTS_MAX = 20;


/** The place a hook's context is given at. */
export function hookPlace(event: string | undefined, name: string | undefined): Place {
  const tool = name?.includes(":") ? name.slice(name.indexOf(":") + 1) : undefined;
  switch (event) {
    case "UserPromptSubmit":
      return "prompt";
    case "PreToolUse":
      return tool ? `tool:${tool}` : "tool:*";
    case "PostToolUse":
    case "PostToolUseFailure":
      return tool ? `tool_result:${tool}` : "tool_result:*";
    case "Stop":
    case "SubagentStop":
      return "reply_end";
    case "PreCompact":
      return "compact";
    default:
      return "session_start";
  }
}

const toolTitle = (name: string) => {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
  return `${mcp ? mcp[2] : name} definition`;
};
const toolBy = (name: string) => /^mcp__(.+?)__/.exec(name)?.[1] ?? CLAUDE_CODE;

/**
 * What the agent was given, built record by record. `add` takes each
 * line; `list` answers the nodes; `spots` says where a node's text is.
 * `ours` (texts the map said in this run, by their start) leaves the
 * map's own hook context out, as the map's nodes already show it.
 */
export class GivenIndex {
  private entries = new Map<string, Entry>();
  /** The latest hook runs that printed context: their event, who they are, whether the map's, their contexts' prints. */
  private hookRuns: { event?: string; who: string; ours: boolean; fps: string[] }[] = [];
  /** Hook contexts not placed yet: placed at `list`, once their hook's run may be known. `text` only from a file here. */
  private pending: { event?: string; hook?: string; fp: string; h: string; n: number; text?: string; spot: Spot; time?: string }[] = [];
  /** Token use and compactions, from the same records (TokenIndex). */
  readonly tokens = new TokenIndex();
  /** The conversation after the start, from the same records (talk.ts). */
  readonly talk = new TalkIndex();

  /** A line of a file read here: as numbers, with its hook contexts' text kept to tell the map's own words. */
  add(line: Line): void {
    let e: any;
    try {
      e = JSON.parse(line.text);
    } catch {
      return;
    }
    const s = slim(e);
    if (!s) return;
    const texts = e.type === "attachment" && e.attachment?.type === "hook_additional_context" ? (Array.isArray(e.attachment.content) ? e.attachment.content : [e.attachment.content]) : undefined;
    this.take(s, line, texts);
  }

  /** A record as numbers (a line read here, or one a hook sent), at its place in the file. */
  take(e: Slim, line: { offset: number; length: number }, texts?: unknown[]): void {
    this.tokens.take(e);
    this.talk.take(e, line);
    const time = e.timestamp;
    this.time = time;
    const at = (pick: Pick): Spot => ({ offset: line.offset, length: line.length, pick });
    if (e.type === "api-request-shape" && e.shape) {
      if (e.shape.system) this.one("system", "System prompt", CLAUDE_CODE, "session_start", e.shape.system, at({ part: "system" }));
      // The latest shape is what the agent has now: a tool gone from it is gone.
      const now = new Set<string>();
      for (const t of e.shape.tools) {
        now.add(t.name);
        this.one(`tool:${t.name}`, toolTitle(t.name), toolBy(t.name), `tool:${t.name}`, t.n, at({ part: "tool", name: t.name }));
      }
      for (const name of [...this.entries.keys()]) if (name.startsWith("tool:") && !now.has(name.slice(5))) this.entries.delete(name);
      return;
    }
    const a = e.attachment;
    if (e.type !== "attachment" || !a || PRIVATE.includes(a.type)) return;
    switch (a.type) {
      case "skill_listing":
        if (a.n) this.more("skills", "Skill listing", CLAUDE_CODE, "skill:*", a.n, at({ part: "listing" }));
        return;
      case "agent_listing_delta":
        if (a.n) this.more("agents", "Agent listing", CLAUDE_CODE, "tool:Agent", a.n, at({ part: "lines" }));
        return;
      case "deferred_tools_delta":
        if (a.n) this.more("deferred", "Deferred tools", CLAUDE_CODE, "tool:ToolSearch", a.n, at({ part: "lines" }));
        return;
      case "model":
        if (a.n !== undefined) this.one("model", "Model", CLAUDE_CODE, "session_start", a.n, at({ part: "model" }));
        return;
      case "mcp_instructions_delta":
        for (const m of a.added ?? []) this.one(`mcp:${m.name}`, `${m.name} instructions`, m.name, `tool:mcp__${m.name}__*`, m.n, at({ part: "mcp", server: m.name }));
        for (const n of a.removed ?? []) this.entries.delete(`mcp:${n}`);
        return;
      case "hook_success":
      case "hook_non_blocking_error":
        if (a.fps?.length) {
          this.hookRuns.push({ ...(a.hookEvent ? { event: a.hookEvent } : {}), who: a.who ?? "unnamed", ours: !!a.ours, fps: a.fps });
          // Kept small: only the hooks that printed context, and only the latest.
          if (this.hookRuns.length > 200) this.hookRuns.shift();
        }
        return;
      case "hook_additional_context":
        (a.content ?? []).forEach((c, index) => {
          if (!c.n) return;
          const t = texts?.[index];
          this.pending.push({ ...(a.hookEvent ? { event: a.hookEvent } : {}), ...(a.hookName ? { hook: a.hookName } : {}), fp: c.fp, h: c.h, n: c.n, ...(typeof t === "string" ? { text: t } : {}), spot: at({ part: "hook", index }), ...(time ? { time } : {}) });
        });
        return;
      default:
        // Anything else (prompts, replies, tool results, the session's own context) is the conversation's (talk.ts).
        return;
    }
  }

  /** The nodes, by name. `ours` says whether a hook's text is the map's own. */
  list(ours: (text: string) => boolean = () => false): Given[] {
    for (const p of this.pending.splice(0)) {
      // Its hook: the latest run of that event whose output holds its words (a context's hook name and id may differ from its run's).
      const run = [...this.hookRuns].reverse().find((r) => r.event === p.event && r.fps.includes(p.fp));
      if (run?.ours || (p.text !== undefined && ours(p.text))) continue;
      const who = run?.who ?? "unnamed";
      const place = hookPlace(p.event, p.hook);
      const name = `hook:${place}:${who}`;
      const entry = this.entries.get(name) ?? { name, title: `${who} hook`, by: who, at: place, count: 0, size: 0, spots: [], seen: new Set<string>() };
      entry.count++;
      if (p.time) Object.assign(entry, { first: entry.first ?? p.time, last: p.time });
      if (!entry.seen!.has(p.h)) {
        entry.seen!.add(p.h);
        entry.spots.push(p.spot);
        entry.size += p.n;
        if (entry.spots.length > SPOTS_MAX) entry.spots.shift();
      }
      this.entries.set(name, entry);
      this.piece(name, p.n, p.time);
    }
    return [...this.entries.values()].map(({ spots: _s, seen: _h, ...g }) => g).sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  }

  /** Each time a node was given, and how long: its history, numbers only. */
  piecesOf(name: string): readonly { time?: string; chars: number }[] {
    return this.pieces.get(name) ?? [];
  }

  private pieces = new Map<string, { time?: string; chars: number }[]>();
  private piece(name: string, chars: number, time = this.time) {
    const list = this.pieces.get(name) ?? (this.pieces.set(name, []), this.pieces.get(name)!);
    list.push({ ...(time ? { time } : {}), chars });
    if (list.length > PIECES_MAX) list.shift();
  }

  spots(name: string): Spot[] {
    return this.entries.get(name)?.spots ?? [];
  }

  /** The time of the record being added. */
  private time: string | undefined;
  private when(had: Entry | undefined) {
    const first = had?.first ?? this.time;
    const last = this.time ?? had?.last;
    return { ...(first ? { first } : {}), ...(last ? { last } : {}) };
  }

  /** A node given once, as it is now: the latest record wins. */
  private one(name: string, title: string, by: string, at: Place, size: number, spot: Spot) {
    const had = this.entries.get(name);
    this.entries.set(name, { name, title, by, at, count: (had?.count ?? 0) + 1, size, spots: [spot], ...this.when(had) });
    this.piece(name, size);
  }

  /** A node given in parts (a listing and what is added to it): every part counts. */
  private more(name: string, title: string, by: string, at: Place, size: number, spot: Spot) {
    const had: Entry = this.entries.get(name) ?? { name, title, by, at, count: 0, size: 0, spots: [] };
    Object.assign(had, this.when(had));
    had.count++;
    had.size += size;
    had.spots.push(spot);
    if (had.spots.length > SPOTS_MAX) had.spots.shift();
    this.entries.set(name, had);
    this.piece(name, size);
  }
}

/** A part of one record, as text: what a spot points at. */
export function partOf(line: string, pick: Pick): string | undefined {
  let e: any;
  try {
    e = JSON.parse(line);
  } catch {
    return undefined;
  }
  const a = e?.attachment;
  switch (pick.part) {
    case "system":
      return Array.isArray(e?.shape?.system) ? e.shape.system.map((b: any) => (typeof b?.text === "string" ? b.text : "")).filter(Boolean).join("\n\n") : undefined;
    case "tool": {
      const t = Array.isArray(e?.shape?.tools) ? e.shape.tools.find((x: any) => x?.name === pick.name) : undefined;
      if (!t) return undefined;
      return `${typeof t.description === "string" ? t.description : ""}\n\nInput:\n${JSON.stringify(t.input_schema ?? {}, null, 2)}`.trim();
    }
    case "mcp": {
      const i = Array.isArray(a?.addedNames) ? a.addedNames.indexOf(pick.server) : -1;
      return i >= 0 && typeof a.addedBlocks?.[i] === "string" ? a.addedBlocks[i] : undefined;
    }
    case "listing":
      return typeof a?.content === "string" ? a.content : undefined;
    case "lines":
      return Array.isArray(a?.addedLines) ? a.addedLines.filter((x: unknown) => typeof x === "string").join("\n") : undefined;
    case "model":
      return typeof a?.text === "string" ? a.text : undefined;
    case "hook": {
      const c = Array.isArray(a?.content) ? a.content[pick.index] : pick.index === 0 ? a?.content : undefined;
      return typeof c === "string" ? c : undefined;
    }
  }
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g;

/** A home folder, Windows or POSIX, any slashes: whose it is is never shown. */
const HOME = /\b[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)[^\\/\s"'`]+|\/(?:Users|home)\/[^/\s"'`]+/g;

/** Text fit to show: an email address or a home folder is never shown, and it is cut at TEXT_MAX. */
export function shown(text: string): { text: string; cut: boolean } {
  const clean = text.replace(EMAIL, "(email)").replace(HOME, "~");
  return clean.length > TEXT_MAX ? { text: `${clean.slice(0, TEXT_MAX)}…`, cut: true } : { text: clean, cut: false };
}
