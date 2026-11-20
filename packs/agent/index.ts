/**
 * The agent pack: every say, refusal and act passes through it.
 * Provides agent.node, agent.tree and agent.run (spec/agent.md), and hands
 * each say, refusal, act and miss to exchange.append.
 */
import type {
  Act,
  AgentNode,
  AgentRun,
  AgentTree,
  Answer,
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

interface Registered {
  def: NodeDef;
  info: NodeInfo;
  caller: Caller;
  seq: number;
}

const agent: Pack = {
  id: "agent",
  inject: ["exchange.append"],
  apply(ctx: Context) {
    const exchange = ctx.get<ExchangeAppend>("exchange.append");
    const nodes = new Map<string, Registered>();
    const treeWatchers = new Set<() => void>();
    const runs = new Map<RunId, RunInfo>();
    let seq = 0;

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
      async begin(start) {
        const info: RunInfo = { ...start, started: new Date().toISOString() };
        runs.set(start.run, info);
        await record({ run: start.run, time: info.started, direction: "from_agent", kind: "begin", detail: info as unknown as Json });
        return info;
      },

      async reach(moment: Moment): Promise<Answer> {
        const run = await runOf(moment.run, caller, moment.time);
        const asked = ordered()
          .map((r) => ({ r, place: moment.places.find((p) => r.def.at.some((a) => placeMatches(a, p))) }))
          .filter((x): x is { r: Registered; place: Place } => x.place !== undefined);
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
            answer.said.push({ node: r.info.id, text: u.say });
            await record({ ...base, direction: "to_agent", kind: "say", text: u.say });
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
      },
    }));
  },
};

export default agent;
