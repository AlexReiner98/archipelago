/**
 * A scripted agent: a run played on `agent.run` (spec/agent.md) without a
 * model. Apart from the runtime, so a test or a plugin can use it alone.
 *
 * - `play(run, script)` plays a script's steps: begin, then each step's
 *   reaches and acts in the order the Claude Code adapter makes them, then
 *   end. What was said and refused comes back with each step's answer.
 * - `scriptOf(events)` makes a script from a run recorded on the exchange
 *   (spec/exchange.md): its acts as they were, and its reaches, quiet ones
 *   included, worked out from where things were said and from the acts.
 */
import type { Act, AgentRun, Answer, Place, RunId, RunInfo, RunStart } from "../../spec/agent.ts";
import type { Actor, Json, Time } from "../../spec/common.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";

/** The harness a script's run names, unless the script says another. */
export const HARNESS = "scripted";

/** The places a scripted run reaches, as terms of PLACES. */
export const REACHES = ["session_start", "prompt", "tool:<name>", "file:<path>", "tool_result:<name>", "reply_end", "skill:<name>", "memory:<scope>/<path>", "compact"];

/** One step of a script. Each may give its `time`; else the clock's. */
export type Step = (
  /** A person's message: reach `prompt`, then act `prompt` by the person (`ok: false` when refused). */
  | { prompt: string }
  /**
   * A tool call: reach `tool:<name>` and its `file:` places with the input. A
   * refusal makes the denied call the act (its output the refusal, `ok:
   * false`), as the adapter does. Else act with `output` and `ok` (default
   * true), then reach `tool_result:<name>` with the output.
   */
  | { tool: string; input?: Json; output?: Json; ok?: boolean }
  /** The agent's reply: reach `reply_end`, then act `reply`; a refusal holds it back (a denied act). */
  | { reply: string }
  /** Places reached as they are, with no act: a skill loaded, a compaction. */
  | { reach: Place[]; input?: Json; again?: boolean }
  /** An act as it is, with no reach: a recorded act, a person's decision. */
  | { act: Omit<Act, "run" | "time"> }
) & { time?: Time };

/** A run to play: how it starts, and its steps. */
export interface Script {
  /** The run's start, without its id and agent (given when it is played). */
  start?: Partial<Omit<RunStart, "run" | "agent">>;
  steps: Step[];
  /** Leave the run open: no `end`. */
  open?: boolean;
  /** False: the steps reach `session_start` themselves (a recorded run's do); else it is reached first. */
  opening?: boolean;
}

/** What one step was answered. A step with no reach has no answer. */
export interface Played {
  info: RunInfo;
  steps: { step: Step; answers: Answer[] }[];
  /** Everything said to the agent, in order, with the places reached. */
  said: { places: Place[]; node: string; text: string }[];
  /** Every refusal, in order. */
  refused: { places: Place[]; node: string; text: string; code?: string }[];
}

/** Tool input fields that name the file a tool touches (as the Claude Code adapter reads them). */
const FILE_FIELDS = ["file_path", "notebook_path"];

/** A path as a place argument: relative to the run's folder, with `/`. */
export function relativePath(path: string, cwd?: string): string {
  let p = path.replaceAll("\\", "/");
  if (cwd) {
    const base = cwd.replaceAll("\\", "/").replace(/\/+$/, "") + "/";
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

/**
 * Plays a script on `agent.run`, which must come from a context intercepted
 * for the run (`META.actor`, `META.run`): see `playAs` in index.ts. Begins
 * the run, reaches `session_start`, plays each step, and ends it.
 */
export async function play(agent: AgentRun, run: RunId, actor: Actor, script: Script, clock: () => Time = () => new Date().toISOString()): Promise<Played> {
  const start: RunStart = { harness: HARNESS, reaches: REACHES, ...script.start, run, agent: actor };
  const info = await agent.begin(start);
  const out: Played = { info, steps: [], said: [], refused: [] };
  const reach = async (places: Place[], time: Time, input?: Json, again?: boolean): Promise<Answer> => {
    const answer = await agent.reach({ run, places, time, ...(input !== undefined ? { input } : {}), ...(again ? { again } : {}) });
    for (const s of answer.said) out.said.push({ places, ...s });
    if (answer.refused) out.refused.push({ places, ...answer.refused });
    return answer;
  };
  const act = (a: Omit<Act, "run">) => agent.act({ run, ...a });
  const denied = (answer: Answer): Json => {
    const { node, text, code } = answer.refused!;
    return { refused: node, text, ...(code ? { code } : {}) };
  };

  const first = script.steps[0];
  if (script.opening !== false) out.steps.push({ step: { reach: ["session_start"] }, answers: [await reach(["session_start"], first?.time ?? clock())] });

  for (const step of script.steps) {
    const time = step.time ?? clock();
    const answers: Answer[] = [];
    if ("prompt" in step) {
      const a = await reach(["prompt"], time, step.prompt);
      answers.push(a);
      await act({ place: "prompt", time, kind: "prompt", by: "person", input: step.prompt, ok: !a.refused });
    } else if ("tool" in step) {
      const place = `tool:${step.tool}`;
      const input = step.input ?? null;
      const a = await reach(toolPlaces(step.tool, input, start.cwd), time, input);
      answers.push(a);
      if (a.refused) {
        await act({ place, time, kind: "tool", by: "agent", input, output: denied(a), ok: false });
      } else {
        const output = step.output ?? null;
        await act({ place, time, kind: "tool", by: "agent", input, output, ok: step.ok ?? true });
        answers.push(await reach([`tool_result:${step.tool}`], time, output));
      }
    } else if ("reply" in step) {
      const a = await reach(["reply_end"], time, step.reply);
      answers.push(a);
      if (a.refused) await act({ place: "reply_end", time, kind: "reply", by: "agent", input: step.reply, output: denied(a), ok: false });
      else await act({ place: "reply_end", time, kind: "reply", by: "agent", output: step.reply, ok: true });
    } else if ("reach" in step) {
      answers.push(await reach(step.reach, time, step.input, step.again));
    } else {
      await act({ ...step.act, time });
    }
    out.steps.push({ step, answers });
  }
  if (!script.open) await agent.end(run, clock());
  return out;
}

/** The kinds of event a reach records, at the moment's places and time. */
const REACHED = new Set(["say", "refuse", "gated", "miss", "compact"]);

/**
 * A recorded run as a script, to play again (under another run id) against
 * the nodes loaded now. Its acts are played as they were recorded, a denied
 * one included: the agent's side is what happened, and the map's side is
 * asked again. Its reaches are rebuilt:
 *
 * - The events one reach recorded (says, refusals, holds, a node's miss, a
 *   compaction) share its time; consecutive ones are one reach, at their
 *   places, unless a place comes twice.
 * - A reach where no node spoke left nothing, so it is worked out from the
 *   acts the way the Claude Code adapter makes them: `session_start` after
 *   the start, `prompt` before a person's prompt, a tool call's `tool:` and
 *   `file:` places before its act (with its input) and `tool_result:` after
 *   (with its output), `reply_end` before a reply.
 * - A reach recorded at a tool call's places gains the ones it left out (a
 *   `file:` place where no node spoke) and the call's input.
 *
 * Times are kept, so a replay's events stand in the recorded order. The
 * start is the run's latest `begin` (a later one gives its title), without
 * its id, agent and times; its facts come again from the sources loaded.
 */
export function scriptOf(events: ExchangeEvent[]): Script {
  const sorted = [...events].sort((a, b) => a.seq - b.seq);
  const begins = sorted.filter((e) => e.kind === "begin" && e.detail && typeof e.detail === "object");
  const start: Partial<RunStart> = {};
  for (const b of begins) {
    const { run: _r, agent: _a, started: _s, ended: _e, last: _l, facts, ...rest } = b.detail as unknown as RunInfo;
    Object.assign(start, rest);
    // The facts a source adds are found again; the start's own are kept (a subagent's agent_type).
    if (facts?.agent_type) start.facts = { agent_type: facts.agent_type };
  }
  const cwd = start.cwd;

  // The reaches the events show, and the acts, in seq order.
  type Reach = { kind: "reach"; places: Place[]; time: Time; input?: Json; seq: number };
  type Did = { kind: "act"; act: Omit<Act, "run">; seq: number };
  const items: (Reach | Did)[] = [];
  let open: Reach | undefined;
  for (const e of sorted) {
    if (e.kind === "act" && e.act && e.place) {
      open = undefined;
      items.push({ kind: "act", act: { ...e.act, place: e.place, time: e.time }, seq: e.seq });
    } else if (REACHED.has(e.kind) && e.place) {
      // A compaction starts its own reach: what is said with it is said after it.
      if (!open || open.time !== e.time || open.places.includes(e.place) || e.kind === "compact") {
        open = { kind: "reach", places: [], time: e.time, seq: e.seq, ...(e.kind === "compact" && e.detail !== undefined ? { input: e.detail } : {}) };
        items.push(open);
      }
      if (!open.places.includes(e.place)) open.places.push(e.place);
    } else {
      open = undefined;
    }
  }

  const steps: Step[] = [];
  const firstTime = sorted.find((e) => e.kind === "begin")?.time;
  // The adapter reaches session_start as the run begins (a load read from the transcript may come first).
  const firstAct = items.findIndex((x) => x.kind === "act");
  const hasStart = items.slice(0, firstAct < 0 ? items.length : firstAct).some((x) => x.kind === "reach" && x.places.includes("session_start"));
  if (!hasStart && firstTime) steps.push({ reach: ["session_start"], time: firstTime });

  /** The reach just before item i, if nothing but reaches stand between it and the previous act. */
  const reachBefore = (i: number, has: (places: Place[]) => boolean): Reach | undefined => {
    for (let j = i - 1; j >= 0; j--) {
      const x = items[j]!;
      if (x.kind === "act") return undefined;
      if (has(x.places)) return x;
    }
    return undefined;
  };
  const used = new Set<Reach>();
  const pending: Reach[] = [];
  const flush = () => {
    for (const r of pending) if (!used.has(r)) steps.push({ reach: r.places, time: r.time, ...(r.input !== undefined ? { input: r.input } : {}) });
    pending.length = 0;
  };

  for (let i = 0; i < items.length; i++) {
    const x = items[i]!;
    if (x.kind === "reach") {
      pending.push(x);
      continue;
    }
    const a = x.act;
    const time = a.time;
    if (a.kind === "tool" && a.place.startsWith("tool:")) {
      const tool = a.place.slice("tool:".length);
      const places = toolPlaces(tool, a.input, cwd);
      const before = reachBefore(i, (ps) => ps.some((p) => places.includes(p)));
      if (before) {
        before.places = [...places, ...before.places.filter((p) => !places.includes(p))];
        if (a.input !== undefined) before.input = a.input;
      }
      flush();
      if (!before) steps.push({ reach: places, time, ...(a.input !== undefined ? { input: a.input } : {}) });
      steps.push({ act: a, time });
      // A call that ran reached its result; a denied one never ran.
      const deniedCall = !a.ok && a.output && typeof a.output === "object" && !Array.isArray(a.output) && "refused" in a.output;
      if (!deniedCall) {
        const after = items[i + 1];
        const result = `tool_result:${tool}`;
        if (after?.kind === "reach" && after.places.includes(result)) {
          if (a.output !== undefined) after.input = a.output;
        } else steps.push({ reach: [result], time, ...(a.output !== undefined && a.output !== null ? { input: a.output } : {}) });
      }
      continue;
    }
    if (a.kind === "prompt" || (a.kind === "reply" && a.place === "reply_end")) {
      const place = a.kind === "prompt" ? "prompt" : "reply_end";
      const before = reachBefore(i, (ps) => ps.includes(place));
      const input = a.kind === "prompt" ? a.input : (a.input ?? a.output);
      if (before && input !== undefined) before.input = input;
      flush();
      if (!before) steps.push({ reach: [place], time, ...(input !== undefined ? { input } : {}) });
      steps.push({ act: a, time });
      continue;
    }
    flush();
    steps.push({ act: a, time });
  }
  flush();
  return { start, steps, opening: false };
}
