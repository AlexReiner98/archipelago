/**
 * The harness view's profile hook: the profiles a run is in
 * (`profile.read`), kept live for the run pane's row.
 */
import { useEffect, useState } from "preact/hooks";
import type { RunInfo } from "../../spec/agent.ts";
import type { ProfileInfo, ProfileRead } from "../../spec/profile.ts";

export function profileHook(profiles: ProfileRead) {
  /** The profiles a run is in, kept live. */
  return (info?: RunInfo): ProfileInfo[] | undefined => {
    const [ps, setPs] = useState<ProfileInfo[]>();
    const key = info ? `${info.run}\n${JSON.stringify(info.facts ?? {})}` : "";
    useEffect(() => {
      setPs(undefined);
      if (!info) return;
      let gone = false;
      const load = () => void profiles.of(info).then((x) => !gone && setPs(x));
      load();
      const stop = profiles.watch(load);
      return () => {
        gone = true;
        void stop();
      };
    }, [key]);
    return ps;
  };
}
