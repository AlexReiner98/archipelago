/**
 * The Agents view's hooks over its capabilities: each read kept live,
 * shared by the three fills. Every read is bounded (a page and a cursor,
 * or ids given).
 */
import { useEffect, useMemo, useState } from "preact/hooks";
import type { ActionList } from "../../spec/action.ts";
import type { AgentTree, NodeInfo, RunInfo } from "../../spec/agent.ts";
import type { Json } from "../../spec/common.ts";
import type { ExchangeEvent, ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import type { GraphRead, GraphWatch, Item } from "../../spec/graph.ts";
import type { HereRead } from "../../spec/here.ts";
import type { Hearing, ProfileInfo, ProfileRead } from "../../spec/profile.ts";
import { keepLast } from "./live.ts";

/** What `verdict.read` answers (the verdict pack's own key). */
export type Verdict = "held" | "failed" | "quiet";
export interface RunVerdict {
  run: string;
  node: string;
  verdict: Verdict;
  said: number;
  first: number;
  said_at: string;
  failed_by: number[];
}
export interface NodeRecord {
  node: string;
  said: number;
  runs: number;
  held: number;
  failed: number;
  quiet: number;
  last?: string;
}
export interface VerdictRead {
  run(run: string): Promise<RunVerdict[]>;
  records(page?: { limit?: number }): Promise<{ items: NodeRecord[] }>;
  record(node: string): Promise<NodeRecord | undefined>;
  verdicts(node: string, page?: { limit?: number }): Promise<{ items: RunVerdict[] }>;
  watch(on: (c: { run?: string }) => void): () => void;
}

export interface Caps {
  here: HereRead;
  tree: AgentTree;
  read: ExchangeRead;
  live: ExchangeWatch;
  verdicts: VerdictRead;
  actions: ActionList;
  graph: GraphRead;
  graphLive: GraphWatch;
  profiles: ProfileRead;
}

/** The page key that holds the profile looked at (the harness pack's own). */
export const PROFILE = "harness.profile";
/** The page key set when every run is looked at, not one (the harness pack's own). */
export const ALL = "harness.all";
/** The page key set when every live run is looked at at once (the harness pack's own). */
export const LIVE = "harness.live";
/** How many events the live view keeps, newest last. */
export const LIVE_KEEP = 300;

/** Whether the view watches every live run: asked for, or nothing else picked (no run, not every run, not turned off). */
export function landsLive(live: boolean | undefined, pinned: string | undefined, every: boolean): boolean {
  return live === true || (live === undefined && !pinned && !every);
}

export interface ProfileRow {
  id: string;
  title: string;
  status: string;
  /** The workspace's default: a run nothing else places is in it. */
  fallback?: boolean;
}

/**
 * Runs grouped by the profiles they are in (ids, sorted): a group hears the
 * same nodes. A run whose profiles aren't known yet is a group of its own.
 */
export function groupsOf(runs: RunInfo[], placements: Map<string, ProfileInfo[]>): Map<string, RunInfo[]> {
  const out = new Map<string, RunInfo[]>();
  for (const r of runs) {
    const ps = placements.get(r.run);
    const g = ps ? `p:${ps.map((p) => p.id).sort().join(",")}` : `r:${r.run}`;
    out.set(g, [...(out.get(g) ?? []), r]);
  }
  return out;
}

/**
 * The frame's folded fills with the node pane folded when no node is picked
 * and open when one is; undefined when nothing changes (or the frame keeps
 * no folds).
 */
export function foldForNode(folded: unknown, node: string | undefined, pane = "harness/node"): string[] | undefined {
  if (!Array.isArray(folded)) return undefined;
  const has = folded.includes(pane);
  if (node && has) return folded.filter((k) => k !== pane);
  if (!node && !has) return [...folded, pane];
  return undefined;
}

export function hooks(c: Caps) {
  const useHere = <T extends Json>(key: string): T | undefined => {
    const [v, setV] = useState<T | undefined>(c.here.get<T>(key));
    useEffect(() => c.here.watch(key, (ch) => setV(ch.value as T | undefined)) as () => void, [key]);
    return v;
  };

  const useNodes = (): NodeInfo[] => {
    const [nodes, setNodes] = useState(c.tree.nodes());
    useEffect(() => {
      const stop = c.tree.watch(() => setNodes(c.tree.nodes()));
      setNodes(c.tree.nodes());
      return stop as () => void;
    }, []);
    return nodes;
  };

  const useRuns = (): RunInfo[] => {
    const [runs, setRuns] = useState<RunInfo[]>([]);
    useEffect(() => {
      // Runs come last active first, so any event may move one up: read again, at most every so often.
      let timer: ReturnType<typeof setTimeout> | undefined;
      let gone = false;
      const load = () => void c.read.runs({ limit: 50 }).then((p) => !gone && setRuns(p.items));
      load();
      const stop = c.live.watch({}, (e) => {
        if (timer) return;
        timer = setTimeout(() => ((timer = undefined), load()), e.kind === "begin" || e.kind === "end" ? 0 : 1000);
      });
      return () => {
        gone = true;
        clearTimeout(timer);
        void stop();
      };
    }, []);
    return runs;
  };

  /**
   * The run looked at: none when every live run is (`harness.live`) or every
   * run (`harness.all`), else the one pinned in `here.run`, else the last
   * active (`harness.live` false). With nothing picked, every live run is:
   * the view lands on them.
   */
  const useRun = () => {
    const runs = useRuns();
    const pinned = useHere<string>("here.run");
    const said = useHere<boolean>(LIVE);
    const every = useHere<boolean>(ALL) === true;
    const live = landsLive(said, pinned, every);
    const all = !live && every;
    const run = all || live ? undefined : (pinned ?? runs[0]?.run);
    return { runs, run, pinned, all, live, info: runs.find((r) => r.run === run) };
  };

  /** The runs a profile has in it (`profile.read.of`), from those given; undefined while it reads. */
  const useRunsIn = (runs: RunInfo[], profile: string | undefined): RunInfo[] | undefined => {
    const [inIt, setInIt] = useState<RunInfo[]>();
    const key = `${profile}|${runs.map((r) => r.run).join(",")}`;
    useEffect(() => {
      setInIt(undefined);
      if (!profile) return;
      let gone = false;
      const load = () =>
        void Promise.all(runs.map(async (r) => ((await c.profiles.of(r)).some((p) => p.id === profile) ? r : undefined))).then(
          (xs) => !gone && setInIt(xs.filter((r): r is RunInfo => !!r)),
        );
      load();
      const stop = c.profiles.watch(load);
      return () => {
        gone = true;
        void stop();
      };
    }, [key]);
    return profile ? inIt : runs;
  };

  /**
   * The events of the runs given, as they come: interleaved, the last
   * LIVE_KEEP. Nothing from before. Every run's are kept while watching, so
   * a run that begins shows its first events once it is among those given.
   */
  const useLiveEvents = (runs: string[], on: boolean): ExchangeEvent[] => {
    const [events, setEvents] = useState<ExchangeEvent[]>([]);
    useEffect(() => {
      setEvents([]);
      if (!on) return;
      return c.live.watch({}, (e) => setEvents((es) => keepLast(es, e, LIVE_KEEP))) as () => void;
    }, [on]);
    const key = runs.join(",");
    return useMemo(() => {
      const want = new Set(runs);
      return events.filter((e) => want.has(e.run));
    }, [events, key]);
  };

  /** A run's events in order, kept live. */
  const useEvents = (run?: string): ExchangeEvent[] => {
    const [events, setEvents] = useState<ExchangeEvent[]>([]);
    useEffect(() => {
      setEvents([]);
      if (!run) return;
      let gone = false;
      const bySeq = new Map<number, ExchangeEvent>();
      const show = () => !gone && setEvents([...bySeq.values()].sort((a, b) => a.seq - b.seq));
      const stop = c.live.watch({ run }, (e) => {
        bySeq.set(e.seq, e);
        show();
      });
      void (async () => {
        for (let p = await c.read.events(run, { limit: 500 }); ; p = await c.read.events(run, { limit: 500, after: p.next })) {
          for (const e of p.items) bySeq.set(e.seq, e);
          if (!p.next || gone) break;
        }
        show();
      })();
      return () => {
        gone = true;
        void stop();
      };
    }, [run]);
    return events;
  };

  /** Reloads `load` now and whenever verdicts may have changed for `run` (or every run). */
  const useVerdictData = <T>(load: () => Promise<T>, deps: unknown[], run?: string): T | undefined => {
    const [v, setV] = useState<T>();
    useEffect(() => {
      let gone = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const go = () => void load().then((x) => !gone && setV(x));
      go();
      const stop = c.verdicts.watch((ch) => {
        if (run !== undefined && ch.run !== undefined && ch.run !== run) return;
        clearTimeout(timer);
        timer = setTimeout(go, 150);
      });
      return () => {
        gone = true;
        clearTimeout(timer);
        void stop();
      };
    }, deps);
    return v;
  };

  const useVerdictsOfRun = (run: string | undefined) => useVerdictData(() => (run ? c.verdicts.run(run) : Promise.resolve([])), [run], run) ?? [];
  /** Each node's record across every run. */
  const useRecords = () => useVerdictData(() => c.verdicts.records({ limit: 500 }).then((p) => p.items), []) ?? [];

  const useItem = (id?: string): Item | null => {
    const [item, setItem] = useState<Item | null>(null);
    useEffect(() => {
      setItem(null);
      if (!id) return;
      let gone = false;
      const load = () => void c.graph.get([id]).then(([i]) => !gone && setItem(i ?? null));
      load();
      const stop = c.graphLive.watch({ ids: [id] }, load);
      return () => {
        gone = true;
        void stop();
      };
    }, [id]);
    return item;
  };

  /** Each node item's status (`trial`, `retired`), by item id, kept live. */
  const useStatuses = (): Map<string, string> => {
    const [st, setSt] = useState<Map<string, string>>(new Map());
    useEffect(() => {
      let gone = false;
      const load = async () => {
        const m = new Map<string, string>();
        for (let p = await c.graph.of("node", { limit: 500 }); ; p = await c.graph.of("node", { limit: 500, after: p.next })) {
          for (const i of p.items) if (typeof i.fields.status === "string") m.set(i.id, i.fields.status);
          if (!p.next) break;
        }
        if (!gone) setSt(m);
      };
      void load();
      const stop = c.graphLive.watch({ types: ["node"] }, () => void load());
      return () => {
        gone = true;
        void stop();
      };
    }, []);
    return st;
  };

  const useHas = (name: string): boolean => {
    const has = () => c.actions.list().some((a) => a.name === name);
    const [v, setV] = useState(has());
    useEffect(() => {
      const stop = c.actions.watch(() => setV(has()));
      setV(has());
      return stop as () => void;
    }, [name]);
    return v;
  };

  /** The profiles on the map, by title, kept live. */
  const useProfileList = (): ProfileRow[] => {
    const [list, setList] = useState<ProfileRow[]>([]);
    useEffect(() => {
      let gone = false;
      const load = async () => {
        const out: ProfileRow[] = [];
        for (let p = await c.graph.of("profile", { limit: 500 }); ; p = await c.graph.of("profile", { limit: 500, after: p.next })) {
          for (const i of p.items) out.push({ id: i.id, title: String(i.fields.title ?? i.id), status: String(i.fields.status ?? "shadow"), ...(i.fields.fallback === true ? { fallback: true } : {}) });
          if (!p.next) break;
        }
        if (!gone) setList(out.sort((a, b) => a.title.localeCompare(b.title)));
      };
      void load();
      const stop = c.graphLive.watch({ types: ["profile"] }, () => void load());
      return () => {
        gone = true;
        void stop();
      };
    }, []);
    return list;
  };

  /** The profiles a run is in, kept live. */
  const useRunProfiles = (info?: RunInfo): ProfileInfo[] | undefined => {
    const [ps, setPs] = useState<ProfileInfo[]>();
    const key = info ? `${info.run}\n${JSON.stringify(info.facts ?? {})}` : "";
    useEffect(() => {
      setPs(undefined);
      if (!info) return;
      let gone = false;
      const load = () => void c.profiles.of(info).then((x) => !gone && setPs(x));
      load();
      const stop = c.profiles.watch(load);
      return () => {
        gone = true;
        void stop();
      };
    }, [key]);
    return ps;
  };

  /** The profiles each of the runs given is in, by run, kept live: what each agent shows. */
  const usePlacements = (runs: RunInfo[]): Map<string, ProfileInfo[]> => {
    const [m, setM] = useState<Map<string, ProfileInfo[]>>(new Map());
    const key = runs.map((r) => `${r.run}\n${JSON.stringify(r.facts ?? {})}`).join("\n\n");
    useEffect(() => {
      let gone = false;
      const load = () => void Promise.all(runs.map(async (r) => [r.run, await c.profiles.of(r)] as const)).then((all) => !gone && setM(new Map(all)));
      load();
      const stop = c.profiles.watch(load);
      return () => {
        gone = true;
        void stop();
      };
    }, [key]);
    return m;
  };

  /**
   * The nodes each of the runs given hears (`profile.read.hears`), by run,
   * kept live: each agent's own tree. Runs in the same profiles hear the
   * same nodes, so it is asked once per set of profiles, not once per run.
   */
  const useHears = (runs: RunInfo[], nodes: NodeInfo[], placements: Map<string, ProfileInfo[]>): Map<string, Set<string>> => {
    const [m, setM] = useState<Map<string, Set<string>>>(new Map());
    const groups = groupsOf(runs, placements);
    const key = `${[...groups].map(([g, rs]) => `${g}:${rs.map((r) => r.run).join(",")}`).join("\n")}|${nodes.map((n) => n.id).join(",")}`;
    useEffect(() => {
      let gone = false;
      const load = () =>
        void Promise.all(
          [...groups.values()].map(async (rs) => {
            const hs = await Promise.all(nodes.map(async (n) => [n.id, (await c.profiles.hears(rs[0]!, n)).hears] as const));
            const heard = new Set(hs.filter(([, yes]) => yes).map(([id]) => id));
            return rs.map((r) => [r.run, heard] as const);
          }),
        ).then((all) => !gone && setM(new Map(all.flat())));
      load();
      const stop = c.profiles.watch(load);
      return () => {
        gone = true;
        void stop();
      };
    }, [key]);
    return m;
  };

  /**
   * Whether a run in one profile hears each node (`profile.read.hears` for a
   * run whose only fact is the profile), kept live. Nothing when none is picked.
   */
  const useHearing = (profile: string | undefined, nodes: NodeInfo[]): Map<string, Hearing> | undefined => {
    const [hearing, setHearing] = useState<Map<string, Hearing>>();
    const ids = nodes.map((n) => n.id).join("\n");
    useEffect(() => {
      setHearing(undefined);
      if (!profile) return;
      let gone = false;
      const as: RunInfo = { run: `profile:${profile}`, agent: { kind: "agent", id: "profile" } as RunInfo["agent"], harness: "", reaches: [], started: "", facts: { profiles: [profile] } };
      const load = () =>
        void Promise.all(nodes.map(async (n) => [n.id, await c.profiles.hears(as, n)] as const)).then((all) => !gone && setHearing(new Map(all)));
      load();
      const stop = c.profiles.watch(load);
      return () => {
        gone = true;
        void stop();
      };
    }, [profile, ids]);
    return hearing;
  };

  return { useHere, useNodes, useRun, useRunsIn, useLiveEvents, useEvents, useVerdictData, useVerdictsOfRun, useRecords, useItem, useStatuses, useHas, useProfileList, useRunProfiles, usePlacements, useHears, useHearing };
}

export type Hooks = ReturnType<typeof hooks>;
