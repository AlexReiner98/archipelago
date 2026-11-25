/**
 * Showing a view: `views.view` names it, its arrange is laid over the
 * page's (`slot.arrange`), its settings are set in `here`, and `here.view`
 * is its center fill. Showing another takes the last one's arrange back and
 * clears the settings it set that the next doesn't. Nothing is written: a
 * pick is looking, not a change.
 */
import type { Dispose, Json } from "../../spec/common.ts";
import type { HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotArrange } from "../../spec/slot.ts";
import type { View } from "./pick.ts";

/** The here key naming the view shown: a view item's id, or a kind's. */
export const SHOWN = "views.view";

export interface Shower {
  show(v: View): void;
  shown(): View | undefined;
  /** Takes the last view's arrange back. */
  stop(): void;
}

export function shower(here: HereRead, set: HereSet, arrange: SlotArrange, report: (err: unknown) => void = () => {}): Shower {
  let now: View | undefined;
  let laid: Dispose | undefined;
  const put = (key: string, value: Json | undefined) => {
    try {
      set.set(key, value);
    } catch (err) {
      report(err); // a setting for a key nobody declares now: left out
    }
  };
  return {
    show(v) {
      const last = now;
      now = v;
      const was = laid;
      laid = Object.keys(v.arrange).length ? arrange.lay(v.arrange) : undefined;
      void was?.();
      for (const key of Object.keys(last?.here ?? {})) if (!(key in v.here)) put(key, undefined);
      for (const [key, value] of Object.entries(v.here)) put(key, value);
      put(SHOWN, v.id);
      if (here.get(KEYS.view) !== v.center) put(KEYS.view, v.center);
    },
    shown: () => now,
    stop() {
      void laid?.();
      laid = undefined;
    },
  };
}
