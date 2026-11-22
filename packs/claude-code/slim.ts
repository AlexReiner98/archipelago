/**
 * A Claude Code transcript as numbers, for the hook to send and the
 * transcript pack to index (packs/transcript): each record made `slim` (its
 * kind, time, sizes, tool names and token counts; a hook's context by a hash
 * of its start; never text, a path or an address), and read a page at a time
 * from a byte cursor.
 *
 * Plain Node, no imports from the repository: a server elsewhere serves it
 * beside hook.ts (`/slim.ts`), and the hook imports it from beside itself.
 */
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

/** The field of the hook input a page of the transcript goes in. */
export const TRANSCRIPT_FIELD = "archipelago_transcript";
/** The adapter's answer, as a header: `send` (pages wanted) or `own` (it reads the file). */
export const TRANSCRIPT_HEADER = "x-archipelago-transcript";

/** A message's token use, numbers only. */
export interface SlimUsage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
}

/** A message's block: its kind, its size in characters, an image by its tokens. */
export type SlimBlock =
  | { type: "text" | "thinking" | "redacted_thinking"; n: number }
  | { type: "tool_use"; id?: string; name: string; n: number }
  | { type: "tool_result"; tool_use_id?: string; n: number; img: number; err?: true }
  | { type: "image"; img: number };

export interface SlimAttachment {
  type: string;
  /** A listing's, a delta's added lines', the model's text: how long. */
  n?: number;
  /** MCP instructions added, each server's length, and those gone. */
  added?: { name: string; n: number }[];
  removed?: string[];
  hookEvent?: string;
  hookName?: string;
  /** A hook's run that printed context: who it is (never a path), whether it is the map's own, its contexts' prints. */
  who?: string;
  ours?: true;
  fps?: string[];
  /** A hook's context: each one's print (its start), hash and length, in order. */
  content?: { fp: string; h: string; n: number }[];
}

/** A transcript record without its text: what the transcript pack indexes, here or on a server elsewhere. */
export interface Slim {
  type: string;
  subtype?: string;
  timestamp?: string;
  isMeta?: true;
  isCompactSummary?: true;
  message?: { id?: string; model?: string; usage?: SlimUsage; str?: number; content?: SlimBlock[] };
  attachment?: SlimAttachment;
  /** What the model was sent for an attachment: how long. */
  rendered?: number;
  shape?: { system: number; tools: { name: string; n: number }[] };
  compactMetadata?: { trigger?: string; preTokens?: number; postTokens?: number; cumulativeDroppedTokens?: number };
}

/** An image the size can't be read from: about what a screenshot costs. */
export const IMAGE_TOKENS = 1600;

/** An image's tokens from its base64 data: its pixels, scaled to fit, / 750. */
export function imageTokens(data: unknown): number {
  if (typeof data !== "string" || !data) return IMAGE_TOKENS;
  let bytes: Buffer;
  try {
    bytes = Buffer.from(data.slice(0, 87_384), "base64");
  } catch {
    return IMAGE_TOKENS;
  }
  const size = pngSize(bytes) ?? jpegSize(bytes);
  if (!size) return IMAGE_TOKENS;
  let [w, h] = size;
  const long = Math.max(w, h);
  if (long > 1568) [w, h] = [(w * 1568) / long, (h * 1568) / long];
  const px = w * h;
  const fit = px > 1_150_000 ? 1_150_000 / px : 1;
  return Math.max(1, Math.ceil((px * fit) / 750));
}

function pngSize(b: Buffer): [number, number] | undefined {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return undefined;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

function jpegSize(b: Buffer): [number, number] | undefined {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return undefined;
    const m = b[i + 1]!;
    const len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return undefined;
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

/** Archipelago's own adapter (this script, or its http hook): what it said is the map's, already in the tree. */
export function isOurs(command: string | undefined): boolean {
  if (!command) return false;
  const c = command.replaceAll("\\", "/");
  return /claude-code\/hook\.ts/.test(c) || /archipelago\/hook\.ts/.test(c) || /hook\.ts["']?\s+https?:\/\/\S+\/hook\b/.test(c);
}

const sha = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 12);
/** A hook context's print: its start, enough to find which hook's run printed it. */
export const contextPrint = (text: string) => sha(text.slice(0, 60));

/** The `additionalContext` texts in a hook's output. */
export function contextsIn(stdout: string): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (k === "additionalContext" && typeof x === "string") out.push(x);
      else walk(x);
    }
  };
  try {
    walk(JSON.parse(stdout));
  } catch {
    for (const m of stdout.matchAll(/"additionalContext"\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
      try {
        out.push(JSON.parse(m[1]!) as string);
      } catch {}
    }
  }
  return out;
}

const len = (x: unknown) => (typeof x === "string" ? x.length : 0);
const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : undefined);
const text = (x: unknown) => (typeof x === "string" ? x : undefined);

function blockOf(b: any): SlimBlock | undefined {
  if (!b || typeof b !== "object") return undefined;
  if (b.type === "thinking" || b.type === "redacted_thinking") return { type: b.type, n: len(b.thinking ?? b.data) };
  if (b.type === "tool_use" && typeof b.name === "string") return { type: "tool_use", ...(text(b.id) ? { id: b.id } : {}), name: b.name, n: JSON.stringify(b.input ?? {}).length };
  if (b.type === "tool_result") {
    let n = 0;
    let img = 0;
    if (typeof b.content === "string") n = b.content.length;
    else if (Array.isArray(b.content))
      for (const c of b.content) {
        if (c?.type === "image") img += imageTokens(c.source?.data);
        else n += typeof c?.text === "string" ? c.text.length : JSON.stringify(c ?? "").length;
      }
    return { type: "tool_result", ...(text(b.tool_use_id) ? { tool_use_id: b.tool_use_id } : {}), n, img, ...(b.is_error ? { err: true as const } : {}) };
  }
  if (b.type === "image") return { type: "image", img: imageTokens(b.source?.data) };
  return { type: "text", n: len(b.text) };
}

function attachmentOf(a: any): SlimAttachment {
  const out: SlimAttachment = { type: typeof a.type === "string" ? a.type : "other" };
  switch (a.type) {
    case "skill_listing":
      return { ...out, n: len(a.content) };
    case "agent_listing_delta":
    case "deferred_tools_delta":
      return { ...out, n: Array.isArray(a.addedLines) ? a.addedLines.filter((x: unknown) => typeof x === "string").join("\n").length : 0 };
    case "model":
      return { ...out, n: len(a.text) };
    case "mcp_instructions_delta": {
      const names: unknown[] = Array.isArray(a.addedNames) ? a.addedNames : [];
      const blocks: unknown[] = Array.isArray(a.addedBlocks) ? a.addedBlocks : [];
      const added = names.flatMap((n, i) => (typeof n === "string" && typeof blocks[i] === "string" ? [{ name: n, n: (blocks[i] as string).length }] : []));
      return { ...out, added, removed: (Array.isArray(a.removedNames) ? a.removedNames : []).filter((x: unknown): x is string => typeof x === "string") };
    }
    case "hook_success":
    case "hook_non_blocking_error": {
      const stdout = text(a.stdout);
      if (!stdout?.includes("additionalContext")) return { ...out, ...(text(a.hookEvent) ? { hookEvent: a.hookEvent } : {}) };
      return { ...out, ...(text(a.hookEvent) ? { hookEvent: a.hookEvent } : {}), who: hookWho(text(a.command)), ...(isOurs(text(a.command)) ? { ours: true as const } : {}), fps: contextsIn(stdout).map(contextPrint) };
    }
    case "hook_additional_context": {
      const content: unknown[] = Array.isArray(a.content) ? a.content : typeof a.content === "string" ? [a.content] : [];
      return {
        ...out,
        ...(text(a.hookEvent) ? { hookEvent: a.hookEvent } : {}),
        ...(text(a.hookName) ? { hookName: a.hookName } : {}),
        content: content.map((c) => (typeof c === "string" && c.trim() ? { fp: contextPrint(c), h: sha(c), n: c.length } : { fp: "", h: "", n: 0 })),
      };
    }
    default:
      return out;
  }
}

/** What the model was sent for an attachment. */
export function renderedText(rendered: unknown): string {
  if (!Array.isArray(rendered)) return "";
  return rendered.map((r: any) => (typeof r?.content === "string" ? r.content : Array.isArray(r?.content) ? r.content.map((x: any) => (typeof x?.text === "string" ? x.text : "")).join("") : "")).join("");
}

/**
 * A transcript record as numbers: the kinds the transcript pack reads
 * (a request's shape, messages, attachments, compactions), each text as its
 * length. A side chain (a subagent's, in the main file) and any other kind:
 * nothing.
 */
export function slim(e: any): Slim | undefined {
  if (!e || typeof e !== "object" || e.isSidechain || typeof e.type !== "string") return undefined;
  const base: Slim = {
    type: e.type,
    ...(text(e.subtype) ? { subtype: e.subtype } : {}),
    ...(text(e.timestamp) ? { timestamp: e.timestamp } : {}),
    ...(e.isMeta ? { isMeta: true as const } : {}),
    ...(e.isCompactSummary ? { isCompactSummary: true as const } : {}),
  };
  if (e.type === "api-request-shape" && e.shape && typeof e.shape === "object") {
    const system = Array.isArray(e.shape.system) ? e.shape.system.reduce((n: number, b: any) => n + len(b?.text), 0) : 0;
    const tools = Array.isArray(e.shape.tools) ? e.shape.tools.flatMap((t: any) => (typeof t?.name === "string" ? [{ name: t.name, n: len(t.description) + JSON.stringify(t.input_schema ?? {}).length }] : [])) : [];
    return { ...base, shape: { system, tools } };
  }
  if ((e.type === "assistant" || e.type === "user") && e.message && typeof e.message === "object") {
    const m = e.message;
    const u = m.usage && typeof m.usage === "object" ? m.usage : undefined;
    const usage: SlimUsage | undefined = u
      ? Object.fromEntries(["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens", "output_tokens"].flatMap((k) => (num(u[k]) !== undefined ? [[k, u[k]]] : [])))
      : undefined;
    return {
      ...base,
      message: {
        ...(text(m.id) ? { id: m.id } : {}),
        ...(text(m.model) ? { model: m.model } : {}),
        ...(usage ? { usage } : {}),
        ...(typeof m.content === "string" ? { str: m.content.length } : Array.isArray(m.content) ? { content: m.content.map(blockOf).filter((b: SlimBlock | undefined): b is SlimBlock => !!b) } : {}),
      },
    };
  }
  if (e.type === "system" && e.subtype === "compact_boundary") {
    const m = e.compactMetadata && typeof e.compactMetadata === "object" ? e.compactMetadata : {};
    return {
      ...base,
      compactMetadata: {
        ...(text(m.trigger) ? { trigger: m.trigger } : {}),
        ...(num(m.preTokens) !== undefined ? { preTokens: m.preTokens } : {}),
        ...(num(m.postTokens) !== undefined ? { postTokens: m.postTokens } : {}),
        ...(num(m.cumulativeDroppedTokens) !== undefined ? { cumulativeDroppedTokens: m.cumulativeDroppedTokens } : {}),
      },
    };
  }
  if (e.type === "attachment" && e.attachment && typeof e.attachment === "object") {
    return { ...base, attachment: attachmentOf(e.attachment), ...(Array.isArray(e.rendered) ? { rendered: renderedText(e.rendered).length } : {}) };
  }
  return undefined;
}

// ---------- reading it a page at a time ----------

/** How much of the file one page reads. */
export const PAGE_BYTES = 256 * 1024;
/** The longest line read; a longer one is skipped. A request's shape (system prompt and tools) runs to a few hundred kB. */
export const LINE_MAX = 16 * 1024 * 1024;

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

/** The transcript a hook's run reads: a subagent's own file, else the session's. As the adapter's run facts. */
export function transcriptPath(input: { transcript_path?: unknown; agent_transcript_path?: unknown; agent_id?: unknown; session_id?: unknown }, sub: boolean): string | undefined {
  if (sub && typeof input.agent_transcript_path === "string" && input.agent_transcript_path) return input.agent_transcript_path;
  const main = typeof input.transcript_path === "string" ? input.transcript_path : undefined;
  if (!main || !sub) return main || undefined;
  const at = /^(.*[\\/])([^\\/]+)\.jsonl$/i.exec(main);
  if (!at || typeof input.agent_id !== "string" || !input.agent_id) return undefined;
  const sep = main.includes("\\") ? "\\" : "/";
  return `${at[1]}${at[2]}${sep}subagents${sep}agent-${input.agent_id}.jsonl`;
}

/** How much of the transcript one hook call reads, at most. */
export const SEND_READ = 1024 * 1024;
/** The most one call sends: a page past it is skipped, and said so (`skipped`, its bytes). */
export const SEND_MAX = 256 * 1024;

/** What a hook call sends of the transcript: the records between two byte places, as numbers. */
export interface Sent {
  /** Where the page starts and ends in the file, in bytes, and how big the file is. */
  from: number;
  to: number;
  size: number;
  /** Each record: where it starts, its length, the record as numbers. */
  lines: [number, number, Slim][];
  /** A page past SEND_MAX: its bytes, not sent. */
  skipped?: number;
}

/** The next page from `from`: whole lines, up to SEND_READ bytes, as numbers. Missing file: nothing. */
export async function pageFrom(path: string, from: number, read = SEND_READ, max = SEND_MAX): Promise<Sent | undefined> {
  const lines: [number, number, Slim][] = [];
  let at = from;
  let size = 0;
  while (at - from < read) {
    const page = await readPage(path, at, Math.min(PAGE_BYTES, read));
    if (!page) return at === from ? undefined : { from, to: at, size, lines };
    size = page.size;
    for (const l of page.lines) {
      try {
        const s = slim(JSON.parse(l.text));
        if (s) lines.push([l.offset, l.length, s]);
      } catch {}
    }
    const moved = page.next !== at;
    at = page.next;
    if (!moved || at >= page.size) break;
  }
  return JSON.stringify(lines).length > max ? { from, to: at, size, lines: [], skipped: at - from } : { from, to: at, size, lines };
}
