/**
 * The replay plugin: a trial node is judged on past runs before it waits for
 * live ones. For each trial node (from the grow plugin), it finds recorded
 * runs where the node's place came up, and plays each again with the
 * scripted plugin (`scripted.play`'s `replay`), against the nodes loaded now,
 * so the node is said there. The verdict plugin judges a replay as it judges
 * any run, and keeps its record apart (a run with `replay_of`); the keep
 * plugin says how much a replay counts.
 *
 * - Which runs: the newest `scan` recorded runs (no replays), leaving out
 *   the run the node was written in, the runs it was already said in live,
 *   and the ones already replayed with it said. A run's place came up when
 *   one of its acts, or something said in it, stands at a place the node
 *   listens at (an act at its files too, relative to the run's folder).
 * - How many: up to `per` replays a node, one at a time, newest first.
 * - When: as a trial node comes into the tree (and for the ones there when
 *   the plugin loads), unless `auto: false`; and when asked, `replay.trial`.
 *
 * Injects scripted.play, exchange.read, verdict.read, agent.tree,
 * graph.read and action.register.
 */
import type { ActionRegister } from "../../spec/action.ts";
import type { AgentTree, NodeInfo, Place, RunId, RunInfo } from "../../spec/agent.ts";
import type { Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { ExchangeRead } from "../../spec/exchange.ts";
import type { GraphRead, Item } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import type { ScriptedPlay } from "../scripted/index.ts";
import { cwdOf, placeMatches, relativePath } from "../verdict/judge.ts";

export interface ReplayConfig {
  /** Replays a trial node gets, at most. Default 3: as many as live held runs promote it. */
  per?: number;
  /** How many of the newest recorded runs are looked through. Default 50. */
  scan?: number;
  /** Replay each trial node as it comes. Default true; false: only when asked. */
  auto?: boolean;
}

/** What `verdict.read` answers here (the verdict plugin's own key). */
interface VerdictRead {
  verdicts(node: string, page?: { limit?: number; after?: string }): Promise<{ items: { run: string; replay_of?: string }[]; next?: string }>;
}

/** One replay made for a node. */
export interface Replayed {
  /** The recorded run. */
  of: RunId;
  /** The replay's own run. */
  run: RunId;
}

const PATH_KEYS = ["file_path", "path", "notebook_path"];
const str = (v: Json | undefined) => (typeof v === "string" ? v : "");
const by = { plugin: "replay" };

const replay: Plugin<ReplayConfig> = {
  id: "replay",
  about: "Replays past runs with a trial node said, so it is judged before it waits for live runs.",
  inject: ["scripted.play", "exchange.read", "verdict.read", "agent.tree", "graph.read", "action.register"],
  apply(ctx: Context, config: ReplayConfig = {}) {
    const per = Math.max(0, config.per ?? 3);
    const scan = Math.max(1, Math.min(config.scan ?? 50, 1000));
    const player = ctx.get<ScriptedPlay>("scripted.play");
    const read = ctx.get<ExchangeRead>("exchange.read");
    const verdicts = ctx.get<VerdictRead>("verdict.read");
    const tree = ctx.get<AgentTree>("agent.tree");
    const graph = ctx.get<GraphRead>("graph.read");

    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy: Promise<unknown> = Promise.resolve();
    ctx.effect(() => () => {
      gone = true;
      clearTimeout(timer);
    });

    /** Node and recorded run pairs tried, said or not: not tried again while the plugin is loaded. */
    const tried = new Set<string>();
    /** Each recorded run's places, read once. */
    const placesOf = new Map<RunId, Set<Place>>();

    /** The newest recorded runs, replays left out, at most `scan`. */
    const recorded = async (): Promise<RunInfo[]> => {
      const out: RunInfo[] = [];
      for (let p = await read.runs({ limit: LIMIT_MAX }); ; p = await read.runs({ limit: LIMIT_MAX, after: p.next })) {
        for (const r of p.items) if (!r.facts?.replay_of && out.length < scan) out.push(r);
        if (!p.next || out.length >= scan) return out;
      }
    };

    /** Where a recorded run's acts stood (and their files), and where things were said in it. */
    const places = async (run: RunId): Promise<Set<Place>> => {
      const had = placesOf.get(run);
      if (had) return had;
      const events = [];
      for (let p = await read.events(run, { limit: LIMIT_MAX }); ; p = await read.events(run, { limit: LIMIT_MAX, after: p.next })) {
        events.push(...p.items);
        if (!p.next) break;
      }
      const cwd = cwdOf(events);
      const out = new Set<Place>();
      for (const e of events) {
        if (e.place && (e.kind === "act" || e.kind === "say" || e.kind === "refuse")) out.add(e.place);
        const input = e.kind === "act" ? e.act?.input : undefined;
        if (input && typeof input === "object" && !Array.isArray(input)) {
          for (const k of PATH_KEYS) if (typeof input[k] === "string" && input[k]) out.add(`file:${relativePath(input[k] as string, cwd)}`);
        }
      }
      placesOf.set(run, out);
      return out;
    };

    /** The runs a node was said in live, and the recorded runs replayed with it said. */
    const seen = async (node: string) => {
      const live = new Set<RunId>();
      const replayed = new Set<RunId>();
      for (let p = await verdicts.verdicts(node, { limit: LIMIT_MAX }); ; p = await verdicts.verdicts(node, { limit: LIMIT_MAX, after: p.next })) {
        for (const v of p.items) (v.replay_of ? replayed.add(v.replay_of) : live.add(v.run));
        if (!p.next) return { live, replayed };
      }
    };

    /** The trial nodes in the tree, with their items. */
    const trials = async (): Promise<{ node: NodeInfo; item: Item }[]> => {
      const nodes = tree.nodes().filter((n) => n.source);
      const out: { node: NodeInfo; item: Item }[] = [];
      for (let i = 0; i < nodes.length; i += LIMIT_MAX) {
        const chunk = nodes.slice(i, i + LIMIT_MAX);
        const items = await graph.get(chunk.map((n) => n.source!));
        chunk.forEach((n, k) => {
          const it = items[k];
          if (it && it.fields.status === "trial" && !str(it.fields.voice)) out.push({ node: n, item: it });
        });
      }
      return out;
    };

    /** Replays up to `want` recorded runs where the node's place came up. */
    const replayNode = async (node: NodeInfo, item: Item, want: number, again = false): Promise<Replayed[]> => {
      const { live, replayed } = await seen(node.id);
      const room = Math.max(0, want - (again ? 0 : replayed.size));
      const from = str(item.fields.from_run);
      const done: Replayed[] = [];
      if (!room) return done;
      for (const r of await recorded()) {
        if (gone || done.length >= room) break;
        const key = `${node.id}\n${r.run}`;
        if (r.run === from || live.has(r.run) || replayed.has(r.run) || (!again && tried.has(key))) continue;
        const at = await places(r.run);
        if (![...at].some((p) => node.at.some((a) => placeMatches(a, p)))) continue;
        tried.add(key);
        const played = await player.replay(r.run);
        done.push({ of: r.run, run: played.info.run });
      }
      return done;
    };

    const pass = async () => {
      if (!per) return;
      for (const { node, item } of await trials()) {
        if (gone) return;
        await replayNode(node, item, per);
      }
    };
    const queue = <T>(work: () => Promise<T>): Promise<T> => {
      const next = busy.then(() => (gone ? (undefined as T) : work()));
      busy = next.catch((err) => ctx.runtime.report(ctx.fiber, err));
      return next;
    };
    const soon = () => {
      clearTimeout(timer);
      if (gone || config.auto === false) return;
      timer = setTimeout(() => void queue(pass), 500);
    };
    tree.watch(soon);
    soon();

    ctx.get<ActionRegister>("action.register").register({
      name: "replay.trial",
      title: "Replay past runs with a trial node said",
      doc: "Plays recorded runs where the node's place came up again (scripted.play's replay), against the nodes loaded now, so the verdict plugin judges the node there. Its record from replays is kept apart from the live one. `runs` is how many more (default the plugin's `per`). Answers the replays made.",
      input: {
        type: "object",
        properties: {
          node: { type: "string", description: "The trial node's item id." },
          runs: { type: "integer", description: "How many runs to replay." },
        },
        required: ["node"],
      },
      async run(input: { node: Id; runs?: number }) {
        const [item] = await graph.get([input.node]);
        const node = tree.nodes().find((n) => n.source === input.node);
        if (!item || !node) throw new Refused({ code: "replay.not_loaded", message: `${input.node} is not a node loaded now: only a loaded node is said in a replay.`, by });
        const want = Math.max(1, Math.min(input.runs ?? (per || 3), 20));
        const done = await queue(() => replayNode(node, item, want, input.runs !== undefined));
        return { node: input.node, replayed: done } as unknown as Json;
      },
    });
  },
};

export default replay;
