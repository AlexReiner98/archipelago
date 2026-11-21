/**
 * The harness view's hooks over its capabilities: each read kept live,
 * shared by the three fills. Every read is bounded (a page and a cursor,
 * or ids given).
 */
import { useEffect, useState } from "preact/hooks";
import type { ActionList } from "../../spec/action.ts";
import type { AgentTree, NodeInfo, RunInfo } from "../../spec/agent.ts";
import type { Json } from "../../spec/common.ts";
import type { ExchangeEvent, ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import type { GraphRead, GraphWatch, Item } from "../../spec/graph.ts";
import type { HereRead } from "../../spec/here.ts";
import type { Hearing, ProfileInfo, ProfileRead } from "../../spec/profile.ts";

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
      const load = () => void c.read.runs({ limit: 50 }).then((p) => setRuns(p.items));
      load();
      return c.live.watch({ kinds: ["begin", "end"] }, load) as () => void;
    }, []);
    return runs;
  };

  /** The run looked at: the one pinned in `here.run`, else the newest. */
  const useRun = () => {
    const runs = useRuns();
    const pinned = useHere<string>("here.run");
    const run = pinned ?? runs[0]?.run;
    return { runs, run, pinned, info: runs.find((r) => r.run === run) };
  };

  /** A run's events in order, kept live; `onNew` hears each one appended after the first read. */
  const useEvents = (run?: string, onNew?: { current?: (e: ExchangeEvent) => void }): ExchangeEvent[] => {
    const [events, setEvents] = useState<ExchangeEvent[]>([]);
    useEffect(() => {
      setEvents([]);
      if (!run) return;
      let gone = false;
      let ready = false;
      const bySeq = new Map<number, ExchangeEvent>();
      const show = () => !gone && setEvents([...bySeq.values()].sort((a, b) => a.seq - b.seq));
      const stop = c.live.watch({ run }, (e) => {
        const fresh = !bySeq.has(e.seq);
        bySeq.set(e.seq, e);
        show();
        if (ready && fresh) onNew?.current?.(e);
      });
      void (async () => {
        for (let p = await c.read.events(run, { limit: 500 }); ; p = await c.read.events(run, { limit: 500, after: p.next })) {
          for (const e of p.items) bySeq.set(e.seq, e);
          if (!p.next || gone) break;
        }
        ready = true;
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
  /** How often each node was said, across runs. */
  const useCounts = () => useVerdictData(() => c.verdicts.records({ limit: 500 }).then((p) => new Map(p.items.map((r) => [r.node, r.said]))), []) ?? new Map<string, number>();

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
  const useProfileList = (): { id: string; title: string; status: string }[] => {
    const [list, setList] = useState<{ id: string; title: string; status: string }[]>([]);
    useEffect(() => {
      let gone = false;
      const load = async () => {
        const out: { id: string; title: string; status: string }[] = [];
        for (let p = await c.graph.of("profile", { limit: 500 }); ; p = await c.graph.of("profile", { limit: 500, after: p.next })) {
          for (const i of p.items) out.push({ id: i.id, title: String(i.fields.title ?? i.id), status: String(i.fields.status ?? "shadow") });
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

  return { useHere, useNodes, useRun, useEvents, useVerdictData, useVerdictsOfRun, useCounts, useItem, useStatuses, useHas, useProfileList, useRunProfiles, useHearing };
}

export type Hooks = ReturnType<typeof hooks>;
