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
 * | SubagentStart    | begin the subagent's run (parent: the session's), reach session_start | additionalContext |
 * | SubagentStop     | as Stop, on the subagent's run and transcript, then end it | block (keeps it going)   |
 * | PreCompact       | reach compact (what is said after is a re-saying)       | nothing                      |
 * | PermissionRequest | note the ask; the person's answer becomes a `decision` act | nothing (the dialog shows) |
 * | Notification     | act `notice` at prompt: the run waits on the person     | nothing                      |
 *
 * A PermissionRequest names no tool use id, so an ask is matched to its call
 * by place and input. The person's answer shows in what follows: the call's
 * PostToolUse (allow), or its result in the transcript, read at the next
 * prompt or stop (deny when Claude Code wrote that the person rejected it).
 *
 * A hook from inside a subagent carries its `agent_id`, and belongs to the
 * subagent's own run, `<session>:<agent>` (runIdOf).
 *
 * Every hook but SessionEnd first reads what Claude Code loaded since the
 * last hook from the transcript: a skill's text (`skill:<name>`), and the
 * memory files of an `instructions` attachment (`memory:<scope>/<path>`).
 * Each is noted (`loaded.note`, so a node is there to say it) and reached
 * with what was loaded as the input, ahead of the hook's own places, so a
 * memory file is said before the turn's first tool call. What is said there
 * isn't handed back: Claude Code already loaded it.
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
import { refusalTold, told, type Speakers } from "./context.ts";

export const HARNESS = "claude-code";

/** The places this adapter reaches: every term of edition 1, edition 2's skill: and memory:, and edition 3's compact. */
export const REACHES = ["session_start", "prompt", "tool:<name>", "file:<path>", "tool_result:<name>", "reply_end", "skill:<name>", "memory:<scope>/<path>", "compact"];

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
  /** Set on every hook from inside a subagent, and on SubagentStart/SubagentStop. */
  agent_id?: string;
  agent_type?: string;
  /** SubagentStop: the subagent's own transcript. */
  agent_transcript_path?: string;
  /** PreCompact: `manual` or `auto`. */
  trigger?: string;
  /** Added by the command hook, not Claude Code: origin of the session's folder as host/owner/name. */
  git_remote?: string;
  /** Notification: what kind (`permission_prompt`, `idle_prompt`, …) and its text. */
  notification_type?: string;
  message?: string;
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

/** Everything said, as one block for the model, each node's words under its tag (context.ts). */
export function spoken(answer: Answer, speakers?: Speakers, places?: Place[]): string | undefined {
  return told(answer.said, speakers, places);
}

function contextOf(event: string, answer: Answer, speakers?: Speakers, places?: Place[]): HookOutput {
  const text = spoken(answer, speakers, places);
  return text ? { hookSpecificOutput: { hookEventName: event, additionalContext: text } } : {};
}

/** The refusal's words, with what else was said after them, each under its node's tag. */
export function refusalText(answer: Answer, speakers?: Speakers): string {
  return refusalTold(answer, speakers);
}

/** The run a hook belongs to, as the adapter knows it. */
export interface RunPort {
  /** `agent.run` from the run's own intercepted context. */
  agent: AgentRun;
  /** Whether `begin` has been called for it here. */
  begun: boolean;
  /** The tool use ids a hook saw in this run, so the transcript adds only the rest. */
  seen?: Set<string>;
  /** How far the transcript was read for loads, and the Skill calls seen so far. Absent: not read yet. */
  loads?: { offset: number; skills: Map<string, string> };
  /** Tool calls the harness asked the person about (PermissionRequest) and that no answer has settled yet, by callKey. */
  asks?: Map<string, number>;
  /** When the oldest pending ask was made: only results after it can answer one. */
  askedAt?: Time;
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
  /** The transcript from a byte offset, up to its last whole line, and where that ends. */
  transcriptFrom?: (input: HookInput, offset: number) => Promise<{ text: string; end: number } | undefined>;
  /** How many times each skill:/memory: place was reached in the run, from the record: a restart reads loads again from the start. */
  loadedSaid?: (run: string) => Promise<Map<Place, number>>;
  /** Makes sure a node is there to say a load (the action `loaded.note`). */
  note?: (load: Load) => Promise<void>;
  /** The home folder, written `~` in a memory file's place. */
  home?: string;
  /** Who each node is (`agent.tree`): its title tags its words, its kind orders `session_start`. */
  speakers?: Speakers;
}

/** Something Claude Code loaded into the run: a skill's text or a memory file. */
export interface Load {
  place: Place;
  kind: "skill" | "memory";
  title: string;
  path?: string;
  text: string;
}

/** Claude Code's memory types, as the scopes of `memory:` places. */
const SCOPES: Record<string, string> = { Project: "project", Local: "local", User: "user", AutoMem: "auto", Managed: "managed" };

/** A path with `/`, and `~` for the home folder. */
export function homePath(path: string, home?: string): string {
  const p = path.replaceAll("\\", "/");
  if (!home) return p;
  const h = home.replaceAll("\\", "/").replace(/\/+$/, "");
  const fold = (s: string) => (/^[a-z]:\//i.test(s) ? s.toLowerCase() : s);
  return fold(p).startsWith(fold(h) + "/") ? `~${p.slice(h.length)}` : p;
}

const SKILL_TEXT = /^Base directory for this skill:\s*(.+)$/m;
const textOf = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n") : "";
const baseName = (dir: string) => dir.trim().replaceAll("\\", "/").replace(/\/+$/, "").split("/").pop() ?? dir;

/**
 * What the transcript's lines say Claude Code loaded, in order: memory files
 * from `instructions` attachments, a skill's text from the meta entry that
 * follows its loading (named by its Skill call, else its folder), and the
 * skills an `invoked_skills` attachment loads again after a compaction.
 * `skills` carries the Skill calls' names across reads.
 */
export function loadsIn(transcript: string, skills: Map<string, string> = new Map(), home?: string): Load[] {
  const out: Load[] = [];
  for (const line of transcript.split("\n")) {
    if (!line.trim()) continue;
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e?.isSidechain) continue;
    const a = e?.attachment;
    if (e?.type === "attachment" && a?.type === "instructions" && Array.isArray(a.files)) {
      for (const f of a.files) {
        if (typeof f?.path !== "string" || typeof f.content !== "string") continue;
        const scope = SCOPES[f.type] ?? String(f.type ?? "memory").toLowerCase();
        const path = homePath(f.path, home);
        out.push({ place: `memory:${scope}/${path}`, kind: "memory", title: `${scope} memory ${path}`, path: f.path, text: f.content });
      }
      continue;
    }
    if (e?.type === "attachment" && a?.type === "invoked_skills" && Array.isArray(a.skills)) {
      for (const k of a.skills) {
        if (typeof k?.name !== "string" || typeof k.content !== "string") continue;
        out.push({ place: `skill:${k.name}`, kind: "skill", title: `skill ${k.name}`, ...(typeof k.path === "string" ? { path: k.path } : {}), text: k.content });
      }
      continue;
    }
    const content = e?.message?.content;
    if (e?.type === "assistant" && Array.isArray(content)) {
      for (const b of content) if (b?.type === "tool_use" && b.name === "Skill" && typeof b.input?.skill === "string") skills.set(b.id, b.input.skill);
      continue;
    }
    if (e?.type === "user" && e.isMeta) {
      const text = textOf(content);
      const dir = SKILL_TEXT.exec(text)?.[1];
      if (!dir) continue;
      const name = (e.sourceToolUseID && skills.get(e.sourceToolUseID)) || baseName(dir);
      out.push({ place: `skill:${name}`, kind: "skill", title: `skill ${name}`, path: dir.trim(), text });
    }
  }
  return out;
}

/**
 * Reads what was loaded since the last hook and reaches each load's place.
 * After a restart the transcript is read from its start, and the loads the
 * record already holds (`loadedSaid`) are skipped, so none is said twice.
 */
async function reachLoads(input: HookInput, port: RunPort, options: Options, reach: (places: Place[], value?: Json) => Promise<Answer>): Promise<void> {
  if (!options.transcriptFrom || !input.transcript_path) return;
  const fresh = !port.loads;
  const state = (port.loads ??= { offset: 0, skills: new Map() });
  const got = await options.transcriptFrom(input, state.offset);
  if (!got) return;
  state.offset = got.end;
  let loads = loadsIn(got.text, state.skills, options.home);
  if (fresh && loads.length && options.loadedSaid) {
    const said = await options.loadedSaid(input.session_id);
    loads = loads.filter((l) => {
      const n = said.get(l.place) ?? 0;
      if (n) said.set(l.place, n - 1);
      return !n;
    });
  }
  for (const l of loads) {
    await options.note?.(l);
    await reach([l.place], { kind: l.kind, ...(l.path ? { path: l.path } : {}), text: trim(l.text) as string });
  }
}

/** A tool call as the record holds it: its place and its (cut) input. */
export interface RecordedCall {
  place: Place;
  input?: Json;
}

/**
 * The run a hook belongs to. A subagent's hooks carry its `agent_id`: it is
 * a run of its own, `<session>:<agent>`, whose parent is the session's run,
 * so its tool calls are its own.
 */
export function runIdOf(input: Pick<HookInput, "session_id" | "agent_id">): string {
  return typeof input.agent_id === "string" && input.agent_id ? `${input.session_id}:${input.agent_id}` : input.session_id;
}

export function runStart(input: HookInput, actor: Actor): RunStart {
  const sub = typeof input.agent_id === "string" && input.agent_id;
  return {
    run: runIdOf(input),
    agent: actor,
    harness: HARNESS,
    reaches: REACHES,
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(sub ? { parent: input.session_id, title: input.agent_type ? `${input.agent_type} subagent` : "subagent" } : {}),
    ...(Object.keys(startFacts(input, !!sub)).length ? { facts: startFacts(input, !!sub) } : {}),
  };
}

/**
 * Edition 5 facts the hook input carries: a subagent's type, and the remote
 * the hook read where the session runs (`git_remote`, as host/owner/name), so
 * a server that can't see the folder still knows the repository.
 */
function startFacts(input: HookInput, sub: boolean): Record<string, string> {
  const facts: Record<string, string> = {};
  if (sub && typeof input.agent_type === "string" && input.agent_type) facts.agent_type = input.agent_type;
  if (typeof input.git_remote === "string" && input.git_remote) facts.remote = input.git_remote;
  const path = transcriptPath(input, sub);
  if (path) facts.transcript = path;
  return facts;
}

/**
 * The run's own transcript (packs/transcript reads it): the session's
 * `transcript_path`; a subagent's is beside it, in the session's
 * `subagents` folder, named by its agent id.
 */
export function transcriptPath(input: Pick<HookInput, "transcript_path" | "agent_transcript_path" | "session_id" | "agent_id">, sub: boolean): string | undefined {
  if (sub && typeof input.agent_transcript_path === "string" && input.agent_transcript_path) return input.agent_transcript_path;
  const main = typeof input.transcript_path === "string" ? input.transcript_path : undefined;
  if (!main || !sub) return main || undefined;
  const at = /^(.*[\\/])([^\\/]+)\.jsonl$/i.exec(main);
  if (!at || !input.agent_id) return undefined;
  const sep = main.includes("\\") ? "\\" : "/";
  return `${at[1]}${at[2]}${sep}subagents${sep}agent-${input.agent_id}.jsonl`;
}

/** Handles one hook: calls `agent.run` and answers what the hook prints. */
export async function handle(input: HookInput, port: RunPort, options: Options): Promise<HookOutput> {
  const now = options.now ?? (() => new Date().toISOString());
  const run = runIdOf(input);
  const agent = port.agent;
  const event = input.hook_event_name;

  if (event === "SessionEnd") {
    if (port.begun) await agent.end(run, now());
    port.begun = false;
    return {};
  }
  // Claude Code's own helpers (prompt suggestions, /btw) stop as subagents that never started: not runs.
  if (event === "SubagentStop" && !port.begun) return {};
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
  const who = options.speakers;
  const context = (event: string, answer: Answer, places?: Place[]) => contextOf(event, answer, who, places);
  const refusalText = (answer: Answer) => refusalTold(answer, who);
  // A subagent's loads are in its own transcript, which its hooks don't name until it stops.
  if (run === input.session_id) await reachLoads(input, port, options, reach);

  // The person's answer to a permission ask shows only in what follows: settle what the transcript says now.
  if (event === "UserPromptSubmit" || event === "Stop" || event === "SubagentStop") await settleAsks(input, port, options, act);

  switch (event) {
    case "PreCompact": {
      await reach(["compact"], { trigger: input.trigger ?? "auto" });
      return {};
    }
    case "PermissionRequest": {
      // The harness is about to ask the person. Their answer is recorded when it shows (settleAsks, PostToolUse).
      const asks = (port.asks ??= new Map());
      if (!asks.size) port.askedAt = now();
      const key = callKey(`tool:${input.tool_name ?? "unknown"}`, trim(input.tool_input) ?? null);
      asks.set(key, (asks.get(key) ?? 0) + 1);
      return {};
    }
    case "Notification": {
      const type = typeof input.notification_type === "string" ? input.notification_type : "notice";
      await act({ place: "prompt", kind: "notice", by: "agent", input: { type, ...(typeof input.message === "string" ? { message: trim(input.message) as string } : {}) }, ok: true });
      return {};
    }
    case "SessionStart": {
      const answer = await reach(["session_start"], input.source ? { source: input.source } : undefined);
      return context("SessionStart", answer, ["session_start"]);
    }
    case "SubagentStart": {
      const answer = await reach(["session_start"], { source: "subagent", ...(input.agent_type ? { agent_type: input.agent_type } : {}) });
      return context("SubagentStart", answer, ["session_start"]);
    }
    case "SubagentStop": {
      const own: HookInput = { ...input, ...(typeof input.agent_transcript_path === "string" ? { transcript_path: input.agent_transcript_path } : {}) };
      // What the subagent loaded is in its own transcript, named only now.
      if (own.transcript_path !== input.transcript_path) await reachLoads(own, port, options, reach);
      await replayFailures(own, run, port, options, act);
      const reply = input.last_assistant_message ?? (await options.lastReply?.(own));
      const answer = await reach(["reply_end"], reply === undefined ? undefined : trim(reply));
      if (answer.refused) {
        const { node, text, code } = answer.refused;
        await act({ place: "reply_end", kind: "reply", by: "agent", ...(reply !== undefined ? { input: trim(reply) } : {}), output: { refused: node, text, ...(code ? { code } : {}) }, ok: false });
        return { decision: "block", reason: refusalText(answer) };
      }
      await act({ place: "reply_end", kind: "reply", by: "agent", ...(reply !== undefined ? { output: trim(reply) } : {}), ok: true });
      await agent.end(run, now());
      port.begun = false;
      return {};
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
      const asked = takeAsk(port, `tool:${tool}`, trim(input.tool_input) ?? null);
      if (asked) {
        const denied = failed && REJECTED.test(String(input.error ?? ""));
        await act({ place: `tool:${tool}`, kind: "decision", by: "person", input: trim(input.tool_input) ?? null, output: denied ? "deny" : "allow", ok: !denied });
        // A denied call never ran: the person's decision is the act.
        if (denied) return context(event, await reach([`tool_result:${tool}`], output ?? undefined));
      }
      await act({ place: `tool:${tool}`, kind: "tool", by: "agent", input: trim(input.tool_input) ?? null, output: output ?? null, ok: !failed && !isError(input.tool_response) });
      const answer = await reach([`tool_result:${tool}`], output ?? undefined);
      return context(event, answer);
    }
    case "Stop": {
      await replayFailures(input, run, port, options, act);
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

/** What Claude Code tells the model when the person denied a tool call. */
export const REJECTED = /user doesn't want to proceed|tool use was rejected|user rejected/i;

/** Takes one pending ask for this call, if the harness asked the person about it. */
function takeAsk(port: RunPort, place: Place, input: Json): boolean {
  const key = callKey(place, input);
  const n = port.asks?.get(key) ?? 0;
  if (!n) return false;
  if (n > 1) port.asks!.set(key, n - 1);
  else port.asks!.delete(key);
  return true;
}

/**
 * The person's answers that show in the transcript: for each pending ask,
 * the turn's call with its input whose result is there. A rejection (the
 * result Claude Code writes when the person says no) is `deny`; any other
 * result is `allow`, for a call whose PostToolUse never came. An ask with
 * no result yet stays pending.
 */
export function answersIn(transcript: string, asks: Map<string, number>, since?: Time): { key: string; place: Place; input: Json; allowed: boolean }[] {
  const entries = entriesOf(transcript);
  const uses = new Map<string, { key: string; place: Place; input: Json }>();
  const left = new Map(asks);
  const out: { key: string; place: Place; input: Json; allowed: boolean }[] = [];
  for (const e of entries) {
    for (const b of blocks(e)) {
      if (e.type === "assistant" && b?.type === "tool_use" && typeof b.id === "string") {
        const place = `tool:${String(b.name)}`;
        const input = trim(b.input) ?? null;
        uses.set(b.id, { key: callKey(place, input), place, input });
      }
      if (e.type === "user" && b?.type === "tool_result" && typeof b.tool_use_id === "string") {
        const use = uses.get(b.tool_use_id);
        if (!use || !left.get(use.key)) continue;
        if (since && typeof e.timestamp === "string" && e.timestamp < since) continue;
        left.set(use.key, left.get(use.key)! - 1);
        const c = b.content;
        const text = typeof c === "string" ? c : Array.isArray(c) ? c.filter((x: any) => x?.type === "text").map((x: any) => x.text).join("\n") : "";
        out.push({ ...use, allowed: !(b.is_error === true && REJECTED.test(text)) });
      }
    }
  }
  return out;
}

/** Records the person's answers to pending asks that the transcript shows, as `decision` acts. */
async function settleAsks(input: HookInput, port: RunPort, options: Options, act: (a: Omit<Act, "run" | "time">) => Promise<void>): Promise<void> {
  if (!port.asks?.size || !options.transcript) return;
  const own = typeof input.agent_transcript_path === "string" ? { ...input, transcript_path: input.agent_transcript_path } : input;
  const text = await options.transcript(own);
  if (!text) return;
  for (const a of answersIn(text, port.asks, port.askedAt)) {
    if (!takeAsk(port, a.place, a.input)) continue;
    await act({ place: a.place, kind: "decision", by: "person", input: a.input, output: a.allowed ? "allow" : "deny", ok: a.allowed });
  }
}

/** At a stop, the turn's failed tool calls no hook saw, from the transcript, as failed acts. */
async function replayFailures(input: HookInput, run: string, port: RunPort, options: Options, act: (a: Omit<Act, "run" | "time">) => Promise<void>): Promise<void> {
  if (!port.seen || !options.transcript) return;
  const text = await options.transcript(input);
  if (!text) return;
  const recorded = options.recorded ? await options.recorded(run, turnStart(text)) : undefined;
  for (const f of unseenFailures(text, port.seen, recorded)) {
    port.seen.add(f.id);
    await act({ place: `tool:${f.tool}`, kind: "tool", by: "agent", input: trim(f.input) ?? null, output: trim(f.error) ?? null, ok: false });
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
