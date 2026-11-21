/**
 * The agent pack: every say, refusal and act passes through it.
 * Provides agent.node, agent.tree and agent.run (spec/agent.md), and hands
 * each say, refusal, act and miss to exchange.append. Edition 5: agent.facts
 * (a run's facts, made again at each begin) and agent.gate (a node held back
 * from a run before it is asked, recorded once per run and node as `gated`).
 */
import type {
  Act,
  AgentFacts,
  AgentGate,
  AgentNode,
  AgentRun,
  AgentTree,
  Answer,
  FactSource,
  Facts,
  GateDef,
  Hold,
  Moment,
  NodeDef,
  NodeInfo,
  Place,
  RunId,
  RunInfo,
  Utterance,
} from "../../spec/agent.ts";
import { PLACES } from "../../spec/agent.ts";
import type { Caller, Dispose, Json, Time } from "../../spec/common.ts";
import { Refused, byPosition } from "../../spec/common.ts";
import type { ExchangeAppend, ExchangeEvent } from "../../spec/exchange.ts";
import type { Context, Pack } from "../../runtime/core.ts";

/** A place's family: `tool:` for `tool:Bash`, `prompt` for `prompt`. */
export function familyOf(place: string): string {
  const i = place.indexOf(":");
  return i < 0 ? place : place.slice(0, i + 1);
}

const REFUSABLE = new Map(PLACES.map((p) => [familyOf(p.term), p.refusable]));

/** Whether a refusal at this place stops what is happening there. */
export function refusable(place: Place): boolean {
  return REFUSABLE.get(familyOf(place)) ?? false;
}

/**
 * Whether a node's `at` matches a reached place. The family must be the
 * same; in the argument `**` matches anything and `*` anything but `/`.
 */
export function placeMatches(pattern: Place, place: Place): boolean {
  if (pattern === place) return true;
  const fam = familyOf(pattern);
  if (fam !== familyOf(place) || !fam.endsWith(":")) return false;
  const arg = pattern.slice(fam.length);
  const re = arg
    .split("**")
    .map((part) =>
      part
        .split("*")
        .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*"),
    )
    .join(".*");
  return new RegExp(`^${re}$`).test(place.slice(fam.length));
}

/** The facts a run's start gives itself: its fields, then what its starts said. */
function startFacts(start: RunInfo, given: Facts): Facts {
  const out: Facts = {};
  for (const k of ["harness", "cwd", "parent", "task"] as const) {
    const v = start[k];
    if (typeof v === "string" && v) out[k] = v;
  }
  for (const [k, v] of Object.entries(given)) if (!(k in out)) out[k] = v;
  return out;
}

/** Facts kept to what a fact may be: text, or a list of it. */
export function cleanFacts(raw: unknown): Facts {
  const out: Facts = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string" && v) out[k] = v;
    else if (Array.isArray(v)) {
      const list = v.filter((x): x is string => typeof x === "string" && !!x);
      if (list.length) out[k] = list;
    }
  }
  return out;
}

const holdOf = (h: Hold | null | undefined): { why: string; trial: boolean } | null => {
  if (!h) return null;
  if (typeof h === "string") return { why: h, trial: false };
  return h.why ? { why: h.why, trial: !!h.trial } : null;
};

interface Contributed<T> {
  def: T;
  id: string;
  caller: Caller;
  seq: number;
}

interface Registered {
  def: NodeDef;
  info: NodeInfo;
  caller: Caller;
  seq: number;
}

const agent: Pack = {
  id: "agent",
  about: "Hears what the map says to an agent at each moment of its work, and what the agent does.",
  inject: ["exchange.append"],
  apply(ctx: Context) {
    const exchange = ctx.get<ExchangeAppend>("exchange.append");
    const nodes = new Map<string, Registered>();
    const treeWatchers = new Set<() => void>();
    const runs = new Map<RunId, RunInfo>();
    /**
     * Per run, what was said since its last `compact` (a node and its words),
     * and what was said before it. The same words again in one context are
     * held back (edition 4); said again after a compact, they are re-said.
     */
    const sayings = new Map<RunId, { now: Set<string>; before: Set<string> }>();
    /** Per run: the facts its starts gave (a later begin adds to them), and the nodes a gate has held back. */
    const given = new Map<RunId, Facts>();
    const gated = new Map<RunId, Set<string>>();
    const sources = new Map<string, Contributed<FactSource>>();
    const gates = new Map<string, Contributed<GateDef>>();
    let seq = 0;
    const inOrder = <T,>(m: Map<string, Contributed<T>>) => [...m.values()].sort((a, b) => byPosition(a.caller, b.caller) || a.seq - b.seq);

    const ordered = () => [...nodes.values()].sort((a, b) => byPosition(a.caller, b.caller) || a.seq - b.seq);
    const changed = () => {
      for (const on of [...treeWatchers]) {
        try {
          on();
        } catch (err) {
          ctx.runtime.report(ctx.fiber, err);
        }
      }
    };
    const record = (e: Omit<ExchangeEvent, "id" | "seq">) => exchange.append(e);
    /**
     * A run this pack knows. One it doesn't (it began before this pack was
     * last reloaded, or begin was never called) is taken up as it is, with
     * a miss saying so, so a reload never breaks a run in flight.
     */
    const runOf = async (run: RunId, caller: Caller, time: Time): Promise<RunInfo> => {
      const known = runs.get(run);
      if (known) return known;
      const info: RunInfo = {
        run,
        agent: caller.actor ?? { id: "unknown", kind: "agent" },
        harness: "unknown",
        reaches: [],
        started: time,
      };
      runs.set(run, info);
      await record({ run, time, direction: "from_agent", kind: "miss", text: "This run hadn't begun here (the agent pack reloaded, or begin was never called); taken up as it is." });
      return info;
    };

    ctx.provide<AgentNode>("agent.node", (caller, from) => ({
      node(def): Dispose {
        const id = `${caller.pack}/${def.name}`;
        if (nodes.has(id)) {
          throw new Refused({ code: "agent.node_taken", message: `A node ${id} is already registered.`, by: { pack: "agent" } });
        }
        return from.effect(() => {
          const { speak: _speak, ...rest } = def;
          nodes.set(id, { def, info: { ...rest, id, pack: caller.pack }, caller, seq: seq++ });
          changed();
          return () => {
            nodes.delete(id);
            changed();
          };
        });
      },
    }));

    /** Adds a contribution as the caller's revertible effect. */
    const contribute = <T extends { name: string },>(m: Map<string, Contributed<T>>, what: string, def: T, caller: Caller, from: Context): Dispose => {
      const id = `${caller.pack}/${def.name}`;
      if (m.has(id)) throw new Refused({ code: `agent.${what.replace(" ", "_")}_taken`, message: `A ${what} ${id} is already registered.`, by: { pack: "agent" } });
      return from.effect(() => {
        m.set(id, { def, id, caller, seq: seq++ });
        return () => void m.delete(id);
      });
    };

    ctx.provide<AgentFacts>("agent.facts", (caller, from) => ({
      source: (def) => contribute(sources, "fact source", def, caller, from),
    }));

    ctx.provide<AgentGate>("agent.gate", (caller, from) => ({
      gate: (def) => contribute(gates, "gate", def, caller, from),
    }));

    /** The run's facts: its start's, then each source's in config-tree order; a key already set is kept. */
    const factsOf = async (info: RunInfo, time: Time): Promise<Facts> => {
      const facts = startFacts(info, given.get(info.run) ?? {});
      for (const s of inOrder(sources)) {
        try {
          const add = cleanFacts(await s.def.facts({ ...info, facts: { ...facts } }));
          for (const [k, v] of Object.entries(add)) if (!(k in facts)) facts[k] = v;
        } catch (err) {
          await record({ run: info.run, time, direction: "from_agent", kind: "miss", pack: s.caller.pack, text: `Fact source ${s.id} failed: ${String((err as Error)?.message ?? err)}` });
        }
      }
      return facts;
    };

    /** The first gate that holds the node back from the run, if any. */
    const heldBy = async (node: NodeInfo, run: RunInfo, moment: Moment) => {
      for (const g of inOrder(gates)) {
        try {
          const h = holdOf(await g.def.hold(node, run, moment));
          if (h) return { gate: g.id, ...h };
        } catch (err) {
          await record({ run: moment.run, time: moment.time, direction: "to_agent", kind: "miss", pack: g.caller.pack, node: node.id, text: `Gate ${g.id} failed: ${String((err as Error)?.message ?? err)}` });
        }
      }
      return null;
    };

    ctx.provide<AgentTree>("agent.tree", (_caller, from) => ({
      nodes: () => ordered().map((r) => r.info),
      watch(on): Dispose {
        return from.effect(() => {
          treeWatchers.add(on);
          return () => treeWatchers.delete(on);
        });
      },
    }));

    ctx.provide<AgentRun>("agent.run", (caller) => ({
      /** Again for a run that has begun: it says more about itself (a title, its task), and keeps when it started. */
      async begin(start) {
        const time = new Date().toISOString();
        // A later begin adds to the facts the run's starts gave; what sources found is found again.
        const { facts: startGiven, ...rest } = start;
        given.set(start.run, { ...(given.get(start.run) ?? {}), ...cleanFacts(startGiven) });
        const info: RunInfo = { ...rest, started: runs.get(start.run)?.started ?? time };
        info.facts = await factsOf(info, time);
        runs.set(start.run, info);
        await record({ run: start.run, time, direction: "from_agent", kind: "begin", detail: info as unknown as Json });
        return info;
      },

      async reach(moment: Moment): Promise<Answer> {
        const run = await runOf(moment.run, caller, moment.time);
        const said = sayings.get(moment.run) ?? { now: new Set<string>(), before: new Set<string>() };
        sayings.set(moment.run, said);
        if (moment.places.includes("compact")) {
          // The context is about to go: everything said so far must be said again.
          for (const n of said.now) said.before.add(n);
          said.now.clear();
          await record({ run: moment.run, time: moment.time, place: "compact", direction: "from_agent", kind: "compact", ...(moment.input !== undefined ? { detail: moment.input } : {}) });
        }
        const listening = ordered()
          .map((r) => ({ r, place: moment.places.find((p) => r.def.at.some((a) => placeMatches(a, p))) }))
          .filter((x): x is { r: Registered; place: Place } => x.place !== undefined);
        // Gates first (edition 5): a node held back isn't asked; a hold is recorded once per run and node.
        const told = gated.get(moment.run) ?? new Set<string>();
        gated.set(moment.run, told);
        const asked: typeof listening = [];
        for (const x of listening) {
          const held = gates.size ? await heldBy(x.r.info, run, moment) : null;
          if (held && !told.has(x.r.info.id)) {
            told.add(x.r.info.id);
            await record({ run: moment.run, time: moment.time, place: x.place, direction: "to_agent", kind: "gated", node: x.r.info.id, pack: x.r.info.pack, text: held.why, detail: { gate: held.gate, ...(held.trial ? { trial: true } : {}) } });
          }
          if (!held || held.trial) asked.push(x);
        }
        const replies = await Promise.allSettled(
          asked.map(({ r }) => Promise.resolve().then(() => r.def.speak(moment, run))),
        );
        const answer: Answer = { said: [] };
        for (let i = 0; i < asked.length; i++) {
          const { r, place } = asked[i]!;
          const reply = replies[i]!;
          const base = { run: moment.run, time: moment.time, place, node: r.info.id, pack: r.info.pack };
          if (reply.status === "rejected") {
            await record({ ...base, direction: "to_agent", kind: "miss", text: String(reply.reason?.message ?? reply.reason) });
            continue;
          }
          const u = reply.value as Utterance | null | undefined;
          if (!u) continue;
          if ("say" in u) {
            // The same words from the same node, once per context (edition 4).
            const key = `${r.info.id}\n${u.say}`;
            if (said.now.has(key) && !moment.again && r.def.repeat !== "every") continue;
            answer.said.push({ node: r.info.id, text: u.say });
            const resaid = said.before.has(key) && !said.now.has(key);
            said.now.add(key);
            await record({ ...base, direction: "to_agent", kind: "say", text: u.say, ...(resaid ? { detail: { resaid: true } } : {}) });
          } else if (refusable(place)) {
            if (!answer.refused) answer.refused = { node: r.info.id, text: u.refuse, ...(u.code ? { code: u.code } : {}) };
            await record({ ...base, direction: "to_agent", kind: "refuse", text: u.refuse, ...(u.code ? { detail: { code: u.code } } : {}) });
          } else {
            await record({
              ...base,
              direction: "to_agent",
              kind: "miss",
              text: `Refused at ${place}, where refusing can't stop anything: ${u.refuse}`,
            });
          }
        }
        return answer;
      },

      async act(act: Act) {
        await runOf(act.run, caller, act.time);
        const { run, place, time, ...rest } = act;
        await record({ run, place, time, direction: "from_agent", kind: "act", act: rest });
      },

      async end(run: RunId, time: Time) {
        const info = await runOf(run, caller, time);
        info.ended = time;
        await record({ run, time, direction: "from_agent", kind: "end" });
        runs.delete(run);
        sayings.delete(run);
        given.delete(run);
        gated.delete(run);
      },
    }));
  },
};

export default agent;
