/**
 * The profile pack: which runs a node is for (spec/profile.md). The rules
 * are in model.ts; this file keeps the model from the graph and wires it.
 *
 * - The base `profile`: statuses `shadow` (the first: it only records what
 *   it would hold back) and `on` (it holds), closed `off`. Fields `match`
 *   (a find-line over a run's facts, an optional extra) and `members` (a
 *   find-line over nodes: `at:file:packs/**`, `at:skill:rhino*`).
 * - Links: `in_profile` (a node item → the profile that holds it),
 *   `out_of_profile` (takes one node out), `uses` (an item whose runs are in
 *   it: a repo, a hub). A profile `part_of` another composes: a run in the
 *   part is in the whole too.
 * - Provides `profile.read`, and registers a gate (`agent.gate`) that holds
 *   back a node a run doesn't hear; a shadow's would-be hold is a trial.
 * - A miss in a run where a held node listens is told on its profiles
 *   (`profile.missed`): a record about the profiles and the node, once per
 *   run and node, so a wrong cut shows on the map.
 * - `profile.place {run, profile}` moves a run into one profile: it begins
 *   the run again with `profiles` and `profiles_drop`, as the run tool
 *   does. A run's facts are on the exchange, not the graph, so it writes
 *   nothing; to undo, place the run back (its output says where it was).
 *
 * The pack never knows what other packs do with a profile.
 */
import type { ActionContext, ActionInvoke, ActionRegister } from "../../spec/action.ts";
import type { AgentGate, AgentRun, AgentTree, NodeInfo, RunInfo } from "../../spec/agent.ts";
import type { Dispose, Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import type { GraphRead, GraphWatch, Link } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { ProfileRead } from "../../spec/profile.ts";
import type { BaseDef, LinkDef, TypesDefine } from "../../spec/types.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { placeMatches } from "../agent/index.ts";
import { type Model, type Profile, hearing, matchNode, nodeProfiles, placing, runProfiles } from "./model.ts";

export const TYPE = "profile";
export const IN = "in_profile";
export const OUT = "out_of_profile";
export const USES = "uses";
export const MISSED = "profile.missed";
export const PLACE = "profile.place";

export const PROFILE: BaseDef = {
  name: TYPE,
  doc: "Which runs some nodes are for.",
  statuses: { open: ["shadow", "on"], closed: ["off"] },
  fields: {
    match: { kind: "text", doc: "A find-line over a run's facts (remote:github.com/a/*): an extra way in, besides uses links." },
    members: { kind: "text", doc: "A find-line over nodes (at:file:packs/**, at:skill:rhino*, kind:, words): what it holds besides its links." },
    fallback: { kind: "boolean", doc: "A run no profile matches is in this one: the workspace's default." },
    leave_out: { kind: "json", doc: "Given nodes Claude Code is to leave out of its runs (tool:<name>, mcp:<server>): the lean pack sets and writes them." },
  },
};

export const LINKS: LinkDef[] = [
  { name: IN, doc: "A node the profile holds.", to: [TYPE] },
  { name: OUT, doc: "A node taken out of the profile.", to: [TYPE] },
  { name: USES, doc: "Runs that have this item in their facts (a repo, a hub) are in the profile.", to: [TYPE] },
];

const STATES = new Set(["on", "shadow", "off"]);

async function allPages<T>(read: (after?: string) => Promise<{ items: T[]; next?: string }>): Promise<T[]> {
  const out: T[] = [];
  for (let p = await read(); ; p = await read(p.next)) {
    out.push(...p.items);
    if (!p.next) return out;
  }
}

const profile: Pack = {
  id: "profile",
  about: "Profiles: which agent sessions each node is meant for.",
  inject: ["graph.read", "graph.watch", "types.define", "agent.tree", "agent.gate", "agent.run", "exchange.read", "exchange.watch", "action.register", "action.invoke"],
  async apply(ctx: Context) {
    const graph = ctx.get<GraphRead>("graph.read");
    const tree = ctx.get<AgentTree>("agent.tree");
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    const define = ctx.get<TypesDefine>("types.define");
    define.base(PROFILE);
    for (const l of LINKS) define.link(l);

    // The model, read again whenever a profile or one of its links changes.
    let model: Model = { profiles: new Map() };
    let stale = true;
    let reading: Promise<Model> | undefined;
    const watchers = new Set<() => void>();
    const linksOf = (id: Id, type: string, dir: "in" | "out") =>
      allPages<Link>((after) => graph.links(id, { type, dir }, { limit: LIMIT_MAX, ...(after ? { after } : {}) }));
    const read = async (): Promise<Model> => {
      const items = await allPages((after) => graph.of(TYPE, { limit: LIMIT_MAX, ...(after ? { after } : {}) }));
      const profiles = new Map<Id, Profile>();
      for (const it of items) {
        const status = String(it.fields.status ?? "shadow");
        const [parts, places, holds, drops] = await Promise.all([linksOf(it.id, "part_of", "out"), linksOf(it.id, USES, "in"), linksOf(it.id, IN, "in"), linksOf(it.id, OUT, "in")]);
        profiles.set(it.id, {
          id: it.id,
          title: String(it.fields.title ?? it.id),
          state: (STATES.has(status) ? status : "shadow") as Profile["state"],
          ...(typeof it.fields.match === "string" && it.fields.match ? { match: it.fields.match } : {}),
          ...(typeof it.fields.members === "string" && it.fields.members ? { members: it.fields.members } : {}),
          ...(it.fields.fallback === true ? { fallback: true } : {}),
          parts: parts.map((l) => l.to),
          places: places.map((l) => l.from),
          holds: holds.map((l) => l.from),
          drops: drops.map((l) => l.from),
        });
      }
      for (const p of profiles.values()) p.parts = p.parts.filter((x) => profiles.has(x));
      return { profiles };
    };
    const current = async (): Promise<Model> => {
      while (stale) {
        stale = false;
        reading = read();
        model = await reading;
      }
      return reading ? await reading.then(() => model) : model;
    };
    const changed = () => {
      stale = true;
      for (const on of [...watchers]) {
        try {
          on();
        } catch (err) {
          ctx.runtime.report(ctx.fiber, err);
        }
      }
    };
    ctx.get<GraphWatch>("graph.watch").watch({ types: [TYPE, IN, OUT, USES, "part_of"] }, (change) => {
      // A part_of matters only between profiles; anything else of ours always does.
      const touches = change.facts.some(([, id, field, value]) => field === "type" ? value !== "part_of" : model.profiles.has(id)) || change.facts.some(([, , field, value]) => (field === "from" || field === "to") && model.profiles.has(String(value)));
      if (touches || change.facts.some(([, , f, v]) => f === "type" && v === TYPE)) changed();
    });
    await current();

    const factsOf = (run: RunInfo) => run.facts ?? {};
    const api: ProfileRead = {
      async of(run) {
        return runProfiles(await current(), factsOf(run)).map(({ state: _s, ...p }) => p);
      },
      async hears(run, node) {
        return hearing(await current(), factsOf(run), node);
      },
      async nodes(id) {
        const m = await current();
        const p = m.profiles.get(id);
        if (!p) return { in: [], out: [] };
        const nodes = tree.nodes();
        return {
          in: nodes.filter((n) => !(n.source && p.drops.includes(n.source)) && ((n.source && p.holds.includes(n.source)) || matchNode(p.members, n))).map((n) => n.id),
          out: nodes.filter((n) => n.source && p.drops.includes(n.source)).map((n) => n.id),
        };
      },
      watch(on): Dispose {
        watchers.add(on);
        return () => void watchers.delete(on);
      },
    };
    ctx.provide<ProfileRead>("profile.read", (_caller, from) => ({
      ...api,
      watch: (on) => from.effect(() => api.watch(on)),
    }));

    ctx.get<AgentGate>("agent.gate").gate({
      name: "profiles",
      title: "A node is heard only in the runs its profiles fit",
      async hold(node, run) {
        const h = hearing(await current(), factsOf(run), node);
        if (!h.hears) return h.why;
        return h.shadow ? { why: h.shadow, trial: true } : null;
      },
    });

    // A miss where a held node listens: told on its profiles, once per run and node.
    ctx.get<ActionRegister>("action.register").register({
      name: MISSED,
      title: "Tell a profile a node it held back may have been needed",
      input: {
        type: "object",
        properties: {
          node: { type: "string", description: "The node's id (pack/name)" },
          source: { type: "string", description: "The node's map item, if it has one" },
          profiles: { type: "array", items: { type: "string" } },
          run: { type: "string" },
          place: { type: "string" },
          shadow: { type: "boolean", description: "Only a shadow would have held it back: it was said." },
        },
        required: ["node", "profiles", "run", "place"],
      },
      async run(input: { node: string; source?: Id; profiles: Id[]; run: string; place: string; shadow?: boolean }, call: ActionContext) {
        const id = `i_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const facts: [string, Id, string, Json][] = [
          ["+", id, "type", "record"],
          ["+", id, "title", `${input.shadow ? "Would hold" : "Held"} back ${input.node}, then a miss at ${input.place}`.slice(0, 120)],
          ["+", id, "kind", "finding"],
          ["+", id, "status", "current"],
          ["+", id, "note", input.shadow ? `Run ${input.run}: a profile in shadow would have held this node back, and the run then missed at a place it listens at. Check the cut before switching it on.` : `Run ${input.run}: a profile held this node back, and the run then missed at a place it listens at. The cut may be wrong.`],
        ];
        for (const to of [...input.profiles, ...(input.source ? [input.source] : [])]) {
          const l = `${id}_${to}`;
          facts.push(["+", l, "type", "about"], ["+", l, "from", id], ["+", l, "to", to]);
        }
        call.write(facts as never);
        return { record: id };
      },
    });

    // Moving a run into one profile: begun again with the facts that put it there and nowhere else.
    const exchange = ctx.get<ExchangeRead>("exchange.read");
    const agentRun = ctx.get<AgentRun>("agent.run");
    ctx.get<ActionRegister>("action.register").register({
      name: PLACE,
      title: "Move a run into one profile",
      doc: "Begins the run again with `profiles` naming the profile and `profiles_drop` the others it matched, as the run tool's profiles and drop. Writes nothing to the graph: place it back to undo.",
      input: {
        type: "object",
        properties: {
          run: { type: "string", description: "The run's id" },
          profile: { type: "string", description: "The profile it is to be in" },
        },
        required: ["run", "profile"],
      },
      async run(input: { run: string; profile: Id }) {
        const m = await current();
        if (!m.profiles.has(input.profile)) throw new Refused({ code: "profile.not_found", message: `There is no profile ${input.profile}.`, by: { pack: "profile" } });
        let info: RunInfo | undefined;
        for (let p = await exchange.runs({ limit: LIMIT_MAX }); !info; p = await exchange.runs({ limit: LIMIT_MAX, after: p.next })) {
          info = p.items.find((r) => r.run === input.run);
          if (!p.next) break;
        }
        if (!info) throw new Refused({ code: "profile.no_run", message: `There is no run ${input.run}.`, by: { pack: "profile" } });
        const was = runProfiles(m, factsOf(info)).filter((p) => p.by === "match").map((p) => p.id);
        const facts = placing(m, factsOf(info), input.profile);
        const { started: _s, ended: _e, facts: _f, ...start } = info;
        const begun = await agentRun.begin({ ...start, facts });
        return { run: input.run, was, now: runProfiles(m, factsOf(begun)).map((p) => p.id) };
      },
    });

    const held = new Map<string, Map<string, { trial: boolean }>>();
    const told = new Set<string>();
    ctx.get<ExchangeWatch>("exchange.watch").watch({ kinds: ["gated", "act", "refuse", "end"] }, (e) => {
      if (e.kind === "end") {
        held.delete(e.run);
        return;
      }
      if (e.kind === "gated" && e.node) {
        const byNode = held.get(e.run) ?? new Map();
        held.set(e.run, byNode);
        byNode.set(e.node, { trial: (e.detail as { trial?: boolean } | undefined)?.trial === true });
        return;
      }
      const missed = e.kind === "act" ? e.act?.ok === false : e.kind === "refuse" && (e.detail as { code?: string } | undefined)?.code !== "ask";
      if (!missed || !e.place) return;
      const byNode = held.get(e.run);
      if (!byNode) return;
      for (const node of tree.nodes()) {
        if (!byNode.has(node.id) || told.has(`${e.run}\n${node.id}`)) continue;
        if (!node.at.some((a) => placeMatches(a, e.place!))) continue;
        told.add(`${e.run}\n${node.id}`);
        const ps = nodeProfiles(model, node as NodeInfo);
        const profiles = [...ps.in, ...ps.out].map((p) => p.id);
        if (!profiles.length) continue;
        void invoke
          .invoke({
            action: MISSED,
            input: { node: node.id, ...(node.source ? { source: node.source } : {}), profiles, run: e.run, place: e.place, ...(byNode.get(node.id)!.trial ? { shadow: true } : {}) },
            authority: { of: "agent", basis: "the profile pack: a miss where a node it held back listens" },
            reason: `A miss at ${e.place} after ${node.id} was held back`,
          })
          .then((out) => {
            if (!out.ok) ctx.runtime.report(ctx.fiber, new Error(out.refused.message));
          });
      }
    });
  },
};

export default profile;
