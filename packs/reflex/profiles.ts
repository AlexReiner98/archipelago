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

  /** The node ids a profile holds, or nothing when none is picked. */
  const useProfileNodes = (profile: string, nodes: NodeInfo[]): Set<string> | undefined => {
    const [held, setHeld] = useState<Set<string>>();
    useEffect(() => {
      setHeld(undefined);
      if (!profile) return;
      let gone = false;
      const load = () => void profiles.nodes(profile).then((x) => !gone && setHeld(new Set(x.in)));
      load();
      const stop = profiles.watch(load);
      return () => {
        gone = true;
        void stop();
      };
    }, [profile, nodes.length]);
    return held;
  };
  return { useProfileList, useProfileNodes };
}
