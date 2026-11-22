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
import { createHash } from "node:crypto";
import type { Place } from "../../spec/agent.ts";

/** How much of the file one page reads. */
export const PAGE_BYTES = 256 * 1024;
/** The longest line read; a longer one is skipped. A request's shape (system prompt and tools) runs to a few hundred kB. */
export const LINE_MAX = 16 * 1024 * 1024;
/** The most text one node answers with. */
export const TEXT_MAX = 200_000;

export interface Line {
  /** Where the line starts in the file, in bytes. */
  offset: number;
  /** Its length in bytes, without the newline. */
  length: number;
  text: string;
}

/**
 * One page of whole lines from `from`, and where the next page starts. A
 * line longer than the page grows the read, up to LINE_MAX; a line longer
 * than that is skipped. A last line without its newline yet is left for the
 * next read. Missing file: nothing.
 */
export async function readPage(path: string, from: number, bytes = PAGE_BYTES): Promise<{ lines: Line[]; next: number; size: number } | undefined> {
  let file;
  try {
    file = await open(path, "r");
  } catch {
    return undefined;
  }
  try {
    const size = (await file.stat()).size;
    if (from >= size) return { lines: [], next: Math.min(from, size), size };
    let want = Math.min(bytes, size - from);
    for (;;) {
      const buf = Buffer.alloc(want);
      const { bytesRead } = await file.read(buf, 0, want, from);
      const got = buf.subarray(0, bytesRead);
      const last = got.lastIndexOf(10);
      if (last >= 0) {
        const lines: Line[] = [];
        let start = 0;
        while (start <= last) {
          const nl = got.indexOf(10, start);
          const end = got[nl - 1] === 13 ? nl - 1 : nl;
          if (end > start) lines.push({ offset: from + start, length: end - start, text: got.subarray(start, end).toString("utf8") });
          start = nl + 1;
        }
        return { lines, next: from + last + 1, size };
      }
      // No newline yet: the line is unfinished at the end of the file, or longer than the read.
      if (from + bytesRead >= size) return { lines: [], next: from, size };
      if (want >= LINE_MAX) return { lines: [], next: await skipLine(file, from + want, size), size };
      want = Math.min(want * 4, LINE_MAX, size - from);
    }
  } finally {
    await file.close();
  }
}

/** Past the next newline from `at`: a line too long to read. */
async function skipLine(file: Awaited<ReturnType<typeof open>>, at: number, size: number): Promise<number> {
  const buf = Buffer.alloc(PAGE_BYTES);
  for (let pos = at; pos < size; pos += PAGE_BYTES) {
    const { bytesRead } = await file.read(buf, 0, PAGE_BYTES, pos);
    const nl = buf.subarray(0, bytesRead).indexOf(10);
    if (nl >= 0) return pos + nl + 1;
  }
  return at;
}

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
  /** About how long its text is, in characters. */
  size: number;
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

/** How many places one hook node keeps texts from; older ones drop off. */
const SPOTS_MAX = 20;

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);

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

/**
 * Who a hook is, from its command: a plugin's name when it runs from a
 * plugin's folder, else its script's name, never a path.
 */
export function hookWho(command: string | undefined): string {
  if (!command) return "unnamed";
  const c = command.replaceAll("\\", "/");
  const plugin = /\/plugins\/(?:cache|marketplaces)\/[^/"' ]+\/(?:plugins\/)?([^/"' ]+)/.exec(c);
  if (plugin) return plugin[1]!;
  const script = /([^/"' ]+)\.(?:m?[jt]s|cjs|py|sh|ps1|cmd|bat|exe)\b/i.exec(c);
  if (script) return script[1]!;
  const first = c.trim().split(/\s+/)[0] ?? "";
  return first.split("/").pop()?.replace(/["']/g, "") || "unnamed";
}

/** Archipelago's own adapter (packs/claude-code/hook.ts, or its http hook): what it said is the map's, already in the tree. */
export function isOurs(command: string | undefined): boolean {
  if (!command) return false;
  const c = command.replaceAll("\\", "/");
  return /claude-code\/hook\.ts/.test(c) || /hook\.ts["']?\s+https?:\/\/\S+\/hook\b/.test(c);
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
  /** The latest hook runs that printed context: their event, command and output. */
  private hookRuns: { event?: string; command?: string; stdout: string }[] = [];
  /** Hook contexts not placed yet: placed at `list`, once their hook's run may be known. */
  private pending: { event?: string; hook?: string; content: string; spot: Spot }[] = [];

  add(line: Line): void {
    let e: any;
    try {
      e = JSON.parse(line.text);
    } catch {
      return;
    }
    if (!e || typeof e !== "object" || e.isSidechain) return;
    const at = (pick: Pick): Spot => ({ offset: line.offset, length: line.length, pick });
    if (e.type === "api-request-shape" && e.shape && typeof e.shape === "object") {
      const system = Array.isArray(e.shape.system) ? e.shape.system : [];
      if (system.length) this.one("system", "System prompt", CLAUDE_CODE, "session_start", system.reduce((n: number, b: any) => n + (typeof b?.text === "string" ? b.text.length : 0), 0), at({ part: "system" }));
      if (Array.isArray(e.shape.tools)) {
        // The latest shape is what the agent has now: a tool gone from it is gone.
        const now = new Set<string>();
        for (const t of e.shape.tools) {
          if (typeof t?.name !== "string") continue;
          now.add(t.name);
          this.one(`tool:${t.name}`, toolTitle(t.name), toolBy(t.name), `tool:${t.name}`, (t.description?.length ?? 0) + JSON.stringify(t.input_schema ?? {}).length, at({ part: "tool", name: t.name }));
        }
        for (const name of [...this.entries.keys()]) if (name.startsWith("tool:") && !now.has(name.slice(5))) this.entries.delete(name);
      }
      return;
    }
    if (e.type !== "attachment" || !e.attachment || typeof e.attachment !== "object") return;
    const a = e.attachment;
    if (PRIVATE.includes(a.type)) return;
    switch (a.type) {
      case "skill_listing":
        if (typeof a.content === "string") this.more("skills", "Skill listing", CLAUDE_CODE, "skill:*", a.content.length, at({ part: "listing" }));
        return;
      case "agent_listing_delta":
        if (Array.isArray(a.addedLines) && a.addedLines.length) this.more("agents", "Agent listing", CLAUDE_CODE, "tool:Agent", a.addedLines.join("\n").length, at({ part: "lines" }));
        return;
      case "deferred_tools_delta":
        if (Array.isArray(a.addedLines) && a.addedLines.length) this.more("deferred", "Deferred tools", CLAUDE_CODE, "tool:ToolSearch", a.addedLines.join("\n").length, at({ part: "lines" }));
        return;
      case "model":
        if (typeof a.text === "string") this.one("model", "Model", CLAUDE_CODE, "session_start", a.text.length, at({ part: "model" }));
        return;
      case "mcp_instructions_delta": {
        const names: unknown[] = Array.isArray(a.addedNames) ? a.addedNames : [];
        const blocks: unknown[] = Array.isArray(a.addedBlocks) ? a.addedBlocks : [];
        names.forEach((n, i) => {
          if (typeof n !== "string" || typeof blocks[i] !== "string") return;
          this.one(`mcp:${n}`, `${n} instructions`, n, `tool:mcp__${n}__*`, (blocks[i] as string).length, at({ part: "mcp", server: n }));
        });
        for (const n of Array.isArray(a.removedNames) ? a.removedNames : []) this.entries.delete(`mcp:${n}`);
        return;
      }
      case "hook_success":
      case "hook_non_blocking_error":
        if (typeof a.stdout === "string" && a.stdout.includes("additionalContext")) {
          this.hookRuns.push({ event: a.hookEvent, ...(typeof a.command === "string" ? { command: a.command } : {}), stdout: a.stdout });
          // Kept small: only the hooks that printed context, and only the latest.
          if (this.hookRuns.length > 200) this.hookRuns.shift();
        }
        return;
      case "hook_additional_context": {
        const content: unknown[] = Array.isArray(a.content) ? a.content : typeof a.content === "string" ? [a.content] : [];
        content.forEach((c, index) => {
          if (typeof c !== "string" || !c.trim()) return;
          this.pending.push({ event: a.hookEvent, hook: a.hookName, content: c, spot: at({ part: "hook", index }) });
        });
        return;
      }
      default:
        // Anything else (prompts, replies, tool results, the session's own context) is not indexed here.
        return;
    }
  }

  /** The nodes, by name. `ours` says whether a hook's text is the map's own. */
  list(ours: (text: string) => boolean = () => false): Given[] {
    for (const p of this.pending.splice(0)) {
      // Its hook: the latest run of that event whose output holds its words (a context's hook name and id may differ from its run's).
      const needle = JSON.stringify(p.content.slice(0, 60)).slice(1, -1);
      const run = [...this.hookRuns].reverse().find((r) => r.event === p.event && r.stdout.includes(needle));
      if (isOurs(run?.command) || ours(p.content)) continue;
      const who = hookWho(run?.command);
      const place = hookPlace(p.event, p.hook);
      const name = `hook:${place}:${who}`;
      const entry = this.entries.get(name) ?? { name, title: `${who} hook`, by: who, at: place, count: 0, size: 0, spots: [], seen: new Set<string>() };
      entry.count++;
      const h = hash(p.content);
      if (!entry.seen!.has(h)) {
        entry.seen!.add(h);
        entry.spots.push(p.spot);
        entry.size += p.content.length;
        if (entry.spots.length > SPOTS_MAX) entry.spots.shift();
      }
      this.entries.set(name, entry);
    }
    return [...this.entries.values()].map(({ spots: _s, seen: _h, ...g }) => g).sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  }

  spots(name: string): Spot[] {
    return this.entries.get(name)?.spots ?? [];
  }

  /** A node given once, as it is now: the latest record wins. */
  private one(name: string, title: string, by: string, at: Place, size: number, spot: Spot) {
    const had = this.entries.get(name);
    this.entries.set(name, { name, title, by, at, count: (had?.count ?? 0) + 1, size, spots: [spot] });
  }

  /** A node given in parts (a listing and what is added to it): every part counts. */
  private more(name: string, title: string, by: string, at: Place, size: number, spot: Spot) {
    const had = this.entries.get(name) ?? { name, title, by, at, count: 0, size: 0, spots: [] };
    had.count++;
    had.size += size;
    had.spots.push(spot);
    if (had.spots.length > SPOTS_MAX) had.spots.shift();
    this.entries.set(name, had);
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

/** Text fit to show: an email address is never shown, and it is cut at TEXT_MAX. */
export function shown(text: string): { text: string; cut: boolean } {
  const clean = text.replace(EMAIL, "(email)");
  return clean.length > TEXT_MAX ? { text: `${clean.slice(0, TEXT_MAX)}…`, cut: true } : { text: clean, cut: false };
}
