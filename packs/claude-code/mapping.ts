/**
 * Claude Code's hooks, as calls of `agent.run`. Pure: it is handed the run's
 * `agent.run` and answers what the hook should print. Nothing here records
 * or decides anything; the agent pack does that.
 *
 * | Hook             | Calls                                                  | Prints                       |
 * |------------------|--------------------------------------------------------|------------------------------|
 * | SessionStart     | begin (once), reach session_start                      | additionalContext            |
 * | UserPromptSubmit | reach prompt, act prompt (by person)                   | additionalContext, or block  |
 * | PreToolUse       | reach tool:<name> + file:<path>; act ok:false if refused | additionalContext, or deny |
 * | PostToolUse      | act tool, reach tool_result:<name>                     | additionalContext            |
 * | PostToolUseFailure | act tool ok:false, reach tool_result:<name>          | additionalContext            |
 * | Stop             | act each unseen failed tool, reach reply_end, act reply (denied if refused) | block (keeps it going) |
 * | SessionEnd       | end                                                    | nothing                      |
 *
 * Claude Code rejects some tool calls before any hook runs (an Edit whose
 * old_string isn't in the file): the model sees the error, the hooks never
 * do. At Stop, the turn's errored tool results that no hook saw are read
 * from the transcript and recorded as failed acts, so a miss is never lost.
 * What is already on the record is read back from the exchange, not only
 * remembered, so a restart mid-turn never records a call twice.
 */
import type { Act, AgentRun, Answer, Moment, Place, RunStart } from "../../spec/agent.ts";
import type { Actor, Json, Time } from "../../spec/common.ts";

export const HARNESS = "claude-code";

/** The places this adapter reaches: every term of edition 1. */
export const REACHES = ["session_start", "prompt", "tool:<name>", "file:<path>", "tool_result:<name>", "reply_end"];

/** What every Claude Code hook is sent on stdin (or as the body of an http hook). */
export interface HookInput {
  hook_event_name: string;
  session_id: string;
  cwd?: string;
  transcript_path?: string;
  source?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Json;
  tool_response?: Json;
  tool_use_id?: string;
  error?: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string;
  reason?: string;
  [key: string]: unknown;
}

/** What the hook prints. Empty: nothing to say. */
export type HookOutput = Record<string, Json>;

/** Tool input fields that name the file the tool will touch. */
const FILE_FIELDS = ["file_path", "notebook_path"];

/** A path as a place argument: relative to the run's folder, with `/`. */
export function relativePath(path: string, cwd?: string): string {
  const norm = (p: string) => p.replaceAll("\\", "/");
  let p = norm(path);
  if (cwd) {
    const base = norm(cwd).replace(/\/+$/, "") + "/";
    const fold = (s: string) => (/^[a-z]:\//i.test(s) ? s.toLowerCase() : s);
    if (fold(p).startsWith(fold(base))) p = p.slice(base.length);
  }
  return p;
}

/** The places a tool call reaches: its `tool:`, and a `file:` for each file in its input. */
export function toolPlaces(tool: string, input: Json | undefined, cwd?: string): Place[] {
  const places: Place[] = [`tool:${tool}`];
  if (input && typeof input === "object" && !Array.isArray(input)) {
    for (const f of FILE_FIELDS) {
      const v = input[f];
      if (typeof v === "string" && v) places.push(`file:${relativePath(v, cwd)}`);
    }
  }
  return places;
}

/** Long tool results are cut, so one Read doesn't fill the record. */
export const TEXT_MAX = 4000;
export function trim(value: Json | undefined, max = TEXT_MAX): Json | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}… (${value.length - max} more)` : value;
  if (Array.isArray(value)) return value.map((v) => trim(v, max) ?? null);
  if (typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value)) out[k] = trim(v, max) ?? null;
    return out;
  }
  return value;
}

/** Everything said, as one block for the model, each line naming its node. */
export function spoken(answer: Answer): string | undefined {
  if (!answer.said.length) return undefined;
  return answer.said.map((s) => s.text).join("\n\n");
}

function context(event: string, answer: Answer): HookOutput {
  const text = spoken(answer);
  return text ? { hookSpecificOutput: { hookEventName: event, additionalContext: text } } : {};
}

/** The refusal's words, with what else was said after them. */
function refusalText(answer: Answer): string {
  const rest = spoken(answer);
  return rest ? `${answer.refused!.text}\n\n${rest}` : answer.refused!.text;
}

/** The run a hook belongs to, as the adapter knows it. */
export interface RunPort {
  /** `agent.run` from the run's own intercepted context. */
  agent: AgentRun;
  /** Whether `begin` has been called for it here. */
  begun: boolean;
  /** The tool use ids a hook saw in this run, so the transcript adds only the rest. */
  seen?: Set<string>;
}

export interface Options {
  actor: Actor;
  now?: () => Time;
  /** The reply's text when the hook doesn't carry it (read from the transcript). */
  lastReply?: (input: HookInput) => Promise<string | undefined>;
  /** The transcript, to find the turn's failed tool calls no hook saw. */
  transcript?: (input: HookInput) => Promise<string | undefined>;
  /**
   * The run's tool calls already on the record, from `since` on: read back
   * from the exchange, so a call is recorded once even when the adapter
   * restarted mid-turn and forgot what its hooks saw.
   */
  recorded?: (run: string, since?: Time) => Promise<RecordedCall[]>;
}

/** A tool call as the record holds it: its place and its (cut) input. */
export interface RecordedCall {
  place: Place;
  input?: Json;
}

export function runStart(input: HookInput, actor: Actor): RunStart {
  return {
    run: input.session_id,
    agent: actor,
    harness: HARNESS,
    reaches: REACHES,
    ...(input.cwd ? { cwd: input.cwd } : {}),
  };
}

/** Handles one hook: calls `agent.run` and answers what the hook prints. */
export async function handle(input: HookInput, port: RunPort, options: Options): Promise<HookOutput> {
  const now = options.now ?? (() => new Date().toISOString());
  const run = input.session_id;
  const agent = port.agent;
  const event = input.hook_event_name;

  if (event === "SessionEnd") {
    if (port.begun) await agent.end(run, now());
    port.begun = false;
    return {};
  }
  if (!port.begun) {
    await agent.begin(runStart(input, options.actor));
    port.begun = true;
  }
  const reach = (places: Place[], value?: Json) => {
    const m: Moment = { run, places, time: now() };
    if (value !== undefined) m.input = value;
    return agent.reach(m);
  };
  const act = (a: Omit<Act, "run" | "time">) => agent.act({ run, time: now(), ...a });

  switch (event) {
    case "SessionStart": {
      const answer = await reach(["session_start"], input.source ? { source: input.source } : undefined);
      return context("SessionStart", answer);
    }
    case "UserPromptSubmit": {
      const answer = await reach(["prompt"], input.prompt ?? "");
      await act({ place: "prompt", kind: "prompt", by: "person", input: input.prompt ?? "", ok: !answer.refused });
      if (answer.refused) return { decision: "block", reason: refusalText(answer) };
      return context("UserPromptSubmit", answer);
    }
    case "PreToolUse": {
      const tool = input.tool_name ?? "unknown";
      if (input.tool_use_id) port.seen?.add(input.tool_use_id);
      const answer = await reach(toolPlaces(tool, input.tool_input, input.cwd), trim(input.tool_input));
      if (answer.refused) {
        // The tool won't run, so no PostToolUse: the refused call is the act.
        await act({
          place: `tool:${tool}`,
          kind: "tool",
          by: "agent",
          input: trim(input.tool_input) ?? null,
          output: { refused: answer.refused.node, text: answer.refused.text, ...(answer.refused.code ? { code: answer.refused.code } : {}) },
          ok: false,
        });
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: refusalText(answer),
          },
        };
      }
      return context("PreToolUse", answer);
    }
    case "PostToolUse":
    case "PostToolUseFailure": {
      const tool = input.tool_name ?? "unknown";
      const failed = event === "PostToolUseFailure";
      if (input.tool_use_id) port.seen?.add(input.tool_use_id);
      const output = failed ? (input.error ?? null) : trim(input.tool_response);
      await act({ place: `tool:${tool}`, kind: "tool", by: "agent", input: trim(input.tool_input) ?? null, output: output ?? null, ok: !failed && !isError(input.tool_response) });
      const answer = await reach([`tool_result:${tool}`], output ?? undefined);
      return context(event, answer);
    }
    case "Stop": {
      if (port.seen && options.transcript) {
        const text = await options.transcript(input);
        const since = text ? turnStart(text) : undefined;
        const recorded = text && options.recorded ? await options.recorded(run, since) : undefined;
        for (const f of text ? unseenFailures(text, port.seen, recorded) : []) {
          port.seen.add(f.id);
          await act({ place: `tool:${f.tool}`, kind: "tool", by: "agent", input: trim(f.input) ?? null, output: trim(f.error) ?? null, ok: false });
        }
      }
      const reply = input.last_assistant_message ?? (await options.lastReply?.(input));
      const answer = await reach(["reply_end"], reply === undefined ? undefined : trim(reply));
      if (answer.refused) {
        // The reply was held back: it is the input of a denied act, like a denied tool call.
        const { node, text, code } = answer.refused;
        await act({ place: "reply_end", kind: "reply", by: "agent", ...(reply !== undefined ? { input: trim(reply) } : {}), output: { refused: node, text, ...(code ? { code } : {}) }, ok: false });
        return { decision: "block", reason: refusalText(answer) };
      }
      await act({ place: "reply_end", kind: "reply", by: "agent", ...(reply !== undefined ? { output: trim(reply) } : {}), ok: true });
      return {};
    }
    default:
      return {};
  }
}

/** Whether a tool's response says it failed (`is_error`, or an `error` field). */
function isError(response: Json | undefined): boolean {
  if (!response || typeof response !== "object" || Array.isArray(response)) return false;
  return response.is_error === true || response.isError === true;
}

/**
 * The last thing the agent said, from a Claude Code transcript (JSON lines).
 * Only the text blocks of the last assistant entry.
 */
export function lastAssistantText(transcript: string): string | undefined {
  const lines = transcript.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry?.type !== "assistant") continue;
    const content = entry.message?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) continue;
    const text = content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n");
    if (text) return text;
  }
  return undefined;
}

/** A tool call of the turn that failed, from the transcript. */
export interface TranscriptFailure {
  id: string;
  tool: string;
  input?: Json;
  error: string;
}

function entriesOf(transcript: string): any[] {
  const entries: any[] = [];
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {}
  }
  return entries;
}

const blocks = (e: any): any[] => (Array.isArray(e?.message?.content) ? e.message.content : []);

/** Where the current turn starts: the last prompt (a user entry that isn't a tool result). */
function turnIndex(entries: any[]): number {
  let start = 0;
  entries.forEach((e, i) => {
    if (e?.type === "user" && !e.isMeta && !blocks(e).some((b) => b?.type === "tool_result")) start = i;
  });
  return start;
}

/** When the current turn's prompt was written, if the transcript says. */
export function turnStart(transcript: string): Time | undefined {
  const entries = entriesOf(transcript);
  const t = entries[turnIndex(entries)]?.timestamp;
  return typeof t === "string" && t ? t : undefined;
}

/** What makes two records of a tool call the same call: its place and its cut input. */
const callKey = (place: Place, input: Json | undefined) => `${place} ${JSON.stringify(input ?? null)}`;

/**
 * The current turn's tool calls whose result is an error and that aren't on
 * the record yet, in order. A call is on the record when a hook saw its id
 * (`seen`), or when `recorded` (the turn's tool acts read back from the
 * exchange) holds a call at its place with its input: each recorded call
 * accounts for one transcript call, so the same command failing twice is
 * two calls. With `recorded`, nothing is recorded twice, whatever restarted.
 */
export function unseenFailures(transcript: string, seen: Set<string>, recorded?: RecordedCall[]): TranscriptFailure[] {
  const entries = entriesOf(transcript);
  const left = new Map<string, number>();
  for (const r of recorded ?? []) {
    const k = callKey(r.place, r.input);
    left.set(k, (left.get(k) ?? 0) + 1);
  }
  const uses = new Map<string, { tool: string; input?: Json; onRecord: boolean }>();
  const out: TranscriptFailure[] = [];
  for (const e of entries.slice(turnIndex(entries))) {
    for (const b of blocks(e)) {
      if (e.type === "assistant" && b?.type === "tool_use" && typeof b.id === "string") {
        const tool = String(b.name);
        const k = callKey(`tool:${tool}`, trim(b.input) ?? null);
        const n = left.get(k) ?? 0;
        if (n) left.set(k, n - 1);
        uses.set(b.id, { tool, input: b.input, onRecord: n > 0 || seen.has(b.id) });
      }
      if (e.type === "user" && b?.type === "tool_result" && b.is_error === true && typeof b.tool_use_id === "string") {
        const use = uses.get(b.tool_use_id);
        if (!use || use.onRecord) continue;
        use.onRecord = true;
        const c = b.content;
        const error = typeof c === "string" ? c : Array.isArray(c) ? c.filter((x: any) => x?.type === "text").map((x: any) => x.text).join("\n") : "";
        out.push({ id: b.tool_use_id, tool: use.tool, ...(use.input !== undefined ? { input: use.input } : {}), error: error.replace(/<\/?tool_use_error>/g, "").trim() });
      }
    }
  }
  return out;
}
