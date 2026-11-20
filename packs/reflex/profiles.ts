/**
 * The reflex tree's profile hooks: the profiles on the map, and the nodes
 * one holds (`profile.read`), kept live for the bar's picker.
 */
import { useEffect, useState } from "preact/hooks";
import type { NodeInfo } from "../../spec/agent.ts";
import type { GraphRead, GraphWatch } from "../../spec/graph.ts";
import type { ProfileRead } from "../../spec/profile.ts";

export function profileHooks(graph: GraphRead, graphLive: GraphWatch, profiles: ProfileRead) {
  /** The profiles on the map, by title, kept live. */
  const useProfileList = (): { id: string; title: string }[] => {
    const [list, setList] = useState<{ id: string; title: string }[]>([]);
    useEffect(() => {
      let gone = false;
      const load = async () => {
        const out: { id: string; title: string }[] = [];
        for (let p = await graph.of("profile", { limit: 500 }); ; p = await graph.of("profile", { limit: 500, after: p.next })) {
          for (const i of p.items) out.push({ id: i.id, title: String(i.fields.title ?? i.id) });
          if (!p.next) break;
        }
        if (!gone) setList(out.sort((a, b) => a.title.localeCompare(b.title)));
      };
      void load();
      const stop = graphLive.watch({ types: ["profile"] }, () => void load());
      return () => {
        gone = true;
        void stop();
      };
    }, []);
    return list;
  };

  /**
   * The nodes a run in this profile hears from it: its own and those of every
   * profile it is part of, each with the profiles it comes from, nearest
   * first. A node one of them takes out is left out. Nothing when none is picked.
   */
  const useProfileNodes = (profile: string, nodes: NodeInfo[]): Map<string, string[]> | undefined => {
    const [held, setHeld] = useState<Map<string, string[]>>();
    useEffect(() => {
      setHeld(undefined);
      if (!profile) return;
      let gone = false;
      const load = () => void chainNodes(profile).then((x) => !gone && setHeld(x));
      load();
      const stop = profiles.watch(load);
      return () => {
        gone = true;
        void stop();
      };
    }, [profile, nodes.length]);
    return held;
  };
  /** The profile and what it is part of, at any depth, nearest first, by title. */
  const chain = async (profile: string): Promise<{ id: string; title: string }[]> => {
    const out: { id: string; title: string }[] = [];
    const seen = new Set<string>();
    for (let front = [profile]; front.length; ) {
      const items = (await graph.get(front)).filter((i): i is NonNullable<typeof i> => !!i && i.type === "profile" && !seen.has(i.id));
      const next: string[] = [];
      for (const i of items) {
        seen.add(i.id);
        out.push({ id: i.id, title: String(i.fields.title ?? i.id) });
        for (const l of (await graph.links(i.id, { type: "part_of", dir: "out" }, { limit: 500 })).items) if (!seen.has(l.to)) next.push(l.to);
      }
      front = next;
    }
    return out;
  };

  const chainNodes = async (profile: string): Promise<Map<string, string[]>> => {
    const from = new Map<string, string[]>();
    const out = new Set<string>();
    for (const p of await chain(profile)) {
      const held = await profiles.nodes(p.id);
      for (const n of held.out) out.add(n);
      for (const n of held.in) from.set(n, [...(from.get(n) ?? []), p.title]);
    }
    for (const n of out) from.delete(n);
    return from;
  };

  return { useProfileList, useProfileNodes };
}
