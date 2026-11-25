/**
 * The call plugin: one request to a model, made by a plugin (a domain's judge),
 * recorded as a run of its own on the exchange, under the run that made it.
 *
 * `call.ask(start, ask)`: begins a run (`harness: "call"`, `parent`), reaches
 * the call's places through `agent.run`, so what is said there is chosen by
 * the same nodes and gates (context filters) as an agent's, hands what was said to
 * `ask`, records its answer as a `reply` act at `reply_end`, and ends the
 * run. The domain's own context (`subject`) is recorded by its type and size
 * only, never its text.
 *
 * A call may follow an item (`follow: {item, version}`, a checks test): when
 * a person decides it at that version (`decision` accepted or rejected,
 * `decided_version`), `call.decide` records the decision in the call's run,
 * a `decision` act at `reply_end` (rejected: `ok: false`), and the verdict
 * plugin judges every node said to the call by it.
 *
 * Provides its own `call.ask`; injects `agent.run`, `exchange.read`,
 * `graph.read`, `graph.watch` and `action.register`.
 */
import type { AgentRun, Facts, Place, RunId, RunInfo } from "../../spec/agent.ts";
import type { ActionRegister } from "../../spec/action.ts";
import type { Caller, Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { ExchangeRead } from "../../spec/exchange.ts";
import type { GraphRead, GraphWatch } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Plugin } from "../../runtime/core.ts";

/** What a call's run is, as its `harness` fact says. */
export const CALL = "call";
/** Where a call's answer, and a person's decision on it, stand. */
export const ANSWER_AT = "reply_end";
export const DECIDE = "call.decide";
/** How many of the newest runs are read back on load, to follow their items again. */
export const FOLLOW_BACK = 200;

/** The domain's own context in the request: its kind and size, never its text. */
export interface Subject {
  type: string;
  tokens: number;
}

/** What the model answered, as the domain hands it back. */
export interface Reply {
  text: string;
  subject?: Subject;
  /** The model's own count, when the domain has it. */
  usage?: { input: number; output: number; model?: string };
  /** An item the answer made, whose decision at this version judges the call from now on, as `start.follow` does. */
  follow?: { item: Id; version: string };
}

export interface CallStart {
  /** A name for the call: the rule's function, say. */
  title: string;
  /** The places reached for it (`check:<fn>`, `finding`): nodes listening there are said to it. */
  places: Place[];
  /** The run that made it. Absent: the calling plugin's own run of calls. */
  parent?: RunId;
  /** More facts about the call (`fn`, a test's id). */
  facts?: Facts;
  /** An item whose decision at this version judges the call. */
  follow?: { item: Id; version: string };
}

/** What `ask` is handed: the run, and what the map said at the call's places. */
export interface Asking {
  run: RunId;
  said: { node: string; text: string }[];
}

/** `call.ask`, this plugin's own key. */
export interface CallAsk {
  ask(start: CallStart, ask: (asking: Asking) => Promise<Reply>): Promise<Reply & { run: RunId }>;
}

export type Decision = "accepted" | "rejected";

const newId = () => globalThis.crypto.randomUUID();
const now = () => new Date().toISOString();
const err = (e: unknown) => String((e as Error)?.message ?? e);

/** A call's facts, as its run's begin will carry them. */
export function callFacts(start: CallStart, parent: RunId): Facts {
  return {
    ...(start.facts ?? {}),
    harness: CALL,
    parent,
    ...(start.follow ? { item: start.follow.item, version: start.follow.version } : {}),
  };
}

/** The decision to record for an item as it now stands, for a call that follows it at `version`. */
export function decisionOf(fields: Record<string, Json> | undefined, version: string): Decision | null {
  if (!fields || fields.decided_version !== version) return null;
  return fields.decision === "accepted" || fields.decision === "rejected" ? fields.decision : null;
}

const call: Plugin = {
  id: "call",
  about: "One request to a model, made by a plugin, recorded as a run of its own under the run that made it.",
  inject: ["agent.run", "exchange.read", "graph.read", "graph.watch", "action.register"],
  apply(ctx: Context) {
    const agentRun = ctx.get<AgentRun>("agent.run");
    const exchange = ctx.get<ExchangeRead>("exchange.read");
    const graph = ctx.get<GraphRead>("graph.read");
    /** Per calling plugin, its own run of calls, begun when it first calls without a parent. */
    const own = new Map<string, Promise<RunId>>();
    /** The calls following an item: item → its runs, each with its version and the decision recorded last. */
    const following = new Map<Id, Map<RunId, { version: string; decided?: Decision }>>();
    /** The runs begun here, as begun: to begin one again for a decision. */
    const begun = new Map<RunId, RunInfo>();

    const follow = (item: Id, run: RunId, version: string, decided?: Decision) => {
      const runs = following.get(item) ?? new Map();
      following.set(item, runs);
      runs.set(run, { version, ...(decided ? { decided } : {}) });
    };

    const ownRun = (caller: Caller): Promise<RunId> => {
      let p = own.get(caller.plugin);
      if (!p) {
        const run = `calls:${caller.plugin}:${newId()}`;
        p = agentRun
          .begin({ run, agent: { id: caller.plugin, kind: "agent" }, harness: "calls", reaches: [], title: `${caller.plugin} calls`, facts: { caller: caller.plugin } })
          .then(() => run);
        own.set(caller.plugin, p);
        p.catch(() => own.delete(caller.plugin));
      }
      return p;
    };

    ctx.provide<CallAsk>("call.ask", (caller) => ({
      async ask(start, ask) {
        const parent = start.parent ?? (await ownRun(caller));
        const run = `call:${newId()}`;
        const info = await agentRun.begin({
          run,
          agent: { id: caller.plugin, kind: "agent" },
          harness: CALL,
          reaches: [...start.places, ANSWER_AT],
          title: start.title,
          parent,
          facts: callFacts(start, parent),
        });
        begun.set(run, info);
        if (start.follow) follow(start.follow.item, run, start.follow.version);
        try {
          const answer = await agentRun.reach({ run, places: start.places, time: now() });
          let reply: Reply;
          try {
            reply = await ask({ run, said: answer.said });
          } catch (e) {
            await agentRun.act({ run, place: ANSWER_AT, time: now(), kind: "reply", by: "agent", ok: false, output: { text: err(e) } });
            throw e;
          }
          await agentRun.act({
            run,
            place: ANSWER_AT,
            time: now(),
            kind: "reply",
            by: "agent",
            ok: true,
            ...(reply.subject ? { input: { subject: { type: reply.subject.type, tokens: reply.subject.tokens } } } : {}),
            output: { text: reply.text, ...(reply.usage ? { usage: reply.usage as unknown as Json } : {}) },
          });
          // An item the answer made: the run says more about itself (its facts name the item), and is followed.
          if (reply.follow && !start.follow) {
            const { started: _s, ended: _e, last: _l, ...again } = info;
            const more = await agentRun.begin({ ...again, facts: { ...(info.facts ?? {}), item: reply.follow.item, version: reply.follow.version } });
            begun.set(run, more);
            follow(reply.follow.item, run, reply.follow.version);
          }
          return { ...reply, run };
        } finally {
          await agentRun.end(run, now());
        }
      },
    }));

    /** A run's start as its begins recorded it: from here, else the exchange's newest pages. */
    const findRun = async (run: RunId): Promise<RunInfo | undefined> => {
      const known = begun.get(run);
      if (known) return known;
      let read = 0;
      for (let p = await exchange.runs({ limit: LIMIT_MAX }); read < FOLLOW_BACK * 5; p = await exchange.runs({ limit: LIMIT_MAX, after: p.next })) {
        const r = p.items.find((x) => x.run === run);
        if (r) return r;
        read += p.items.length;
        if (!p.next) break;
      }
      return undefined;
    };

    /** Records a decision in a call's run: begun again, a `decision` act, ended. False: no such call. */
    const decide = async (run: RunId, decision: Decision): Promise<boolean> => {
      const info = await findRun(run);
      if (!info || info.facts?.harness !== CALL) return false;
      const { started: _s, ended: _e, last: _l, ...start } = info;
      await agentRun.begin(start);
      const time = now();
      await agentRun.act({ run, place: ANSWER_AT, time, kind: "decision", by: "person", ok: decision === "accepted", output: { decision } });
      await agentRun.end(run, time);
      return true;
    };

    ctx.get<ActionRegister>("action.register").register({
      name: DECIDE,
      title: "Record a person's decision on a call's answer",
      doc: "Begins the call's run again, records the decision as a `decision` act at `reply_end` (rejected: ok false), and ends it. The verdict plugin judges every node said to the call by it. Writes nothing to the graph.",
      input: {
        type: "object",
        properties: {
          run: { type: "string", description: "The call's run" },
          decision: { type: "string", enum: ["accepted", "rejected"] },
        },
        required: ["run", "decision"],
      },
      async run(input: { run: string; decision: Decision }) {
        if (input.decision !== "accepted" && input.decision !== "rejected") throw new Refused({ code: "call.decision", message: "A decision is accepted or rejected.", by: { plugin: "call" } });
        if (!(await decide(input.run, input.decision))) throw new Refused({ code: "call.no_run", message: `There is no call ${input.run}.`, by: { plugin: "call" } });
        return { run: input.run, decision: input.decision };
      },
    });

    // Following items: a decision at a call's version is recorded in its run, once per change of mind.
    const look = async (ids: Id[]) => {
      const items = await graph.get(ids.slice(0, LIMIT_MAX));
      for (const item of items) {
        if (!item) continue;
        const runs = following.get(item.id);
        if (!runs) continue;
        for (const [run, f] of runs) {
          const d = decisionOf(item.fields, f.version);
          if (!d || d === f.decided) continue;
          f.decided = d;
          try {
            await decide(run, d);
          } catch (e) {
            ctx.runtime.report(ctx.fiber, e);
          }
        }
      }
    };
    ctx.get<GraphWatch>("graph.watch").watch({ fields: ["decision", "decided_version"] }, (change) => {
      const ids = [...new Set(change.facts.map((f) => f[1]))].filter((id) => following.has(id));
      if (ids.length) void look(ids);
    });

    // On load, the newest calls that follow an item are followed again; a decision already in a run is known.
    void (async () => {
      const page = await exchange.runs({ limit: FOLLOW_BACK });
      for (const r of page.items) {
        const f = r.facts;
        if (f?.harness !== CALL || typeof f.item !== "string" || typeof f.version !== "string") continue;
        let decided: Decision | undefined;
        const evs = await exchange.events(r.run, { limit: LIMIT_MAX });
        for (const e of evs.items) if (e.kind === "act" && e.act?.kind === "decision") decided = e.act.ok === false ? "rejected" : "accepted";
        follow(f.item, r.run, f.version, decided);
      }
    })().catch((e) => ctx.runtime.report(ctx.fiber, e));

    // The calling plugins' own runs end with this plugin.
    ctx.effect(() => () => {
      for (const p of own.values()) void p.then((run) => agentRun.end(run, now())).catch(() => {});
    });
  },
};

export default call;
