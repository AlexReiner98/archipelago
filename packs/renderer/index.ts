/**
 * The renderer pack: the one copy of Preact every pack's components run on,
 * and the slot broker (spec/slot.md). Provides slot.declare, slot.fill and
 * slot.read, declares `root`, and mounts the fill of `root` into the page.
 * Unloading it unmounts everything.
 *
 * Packs write components with htm over the same Preact the page's import
 * map names, so there is no build step and one copy.
 */
import { h, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Caller, Dispose } from "../../spec/common.ts";
import { Refused, byPosition } from "../../spec/common.ts";
import type { FillDef, FillInfo, SlotDeclare, SlotDef, SlotFill, SlotRead } from "../../spec/slot.ts";
import { ROOT } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";

export interface RendererConfig {
  /** Where to mount, a CSS selector. Default `#app`. */
  mount?: string;
}

const renderer: Pack<RendererConfig> = {
  id: "renderer",
  apply(ctx: Context, config: RendererConfig = {}) {
    const slots = new Map<string, { def: SlotDef; pack: string }>();
    const fills: { def: FillDef<any>; caller: Caller; n: number }[] = [];
    const watchers = new Map<string, Set<() => void>>();
    let n = 0;

    const changed = (slot: string) => {
      for (const on of [...(watchers.get(slot) ?? [])]) {
        try {
          on();
        } catch (err) {
          ctx.runtime.report(ctx.fiber, err);
        }
      }
    };
    const fillsOf = (slot: string): (FillDef & FillInfo)[] => {
      const s = slots.get(slot);
      if (!s) return [];
      const list = fills
        .filter((f) => f.def.slot === slot)
        .sort((a, b) => byPosition(a.caller, b.caller) || a.n - b.n)
        .map((f) => ({ ...f.def, pack: f.caller.pack }));
      return s.def.merge === "one" ? list.slice(0, 1) : list;
    };
    const watch = (slot: string, on: () => void) => {
      let set = watchers.get(slot);
      if (!set) watchers.set(slot, (set = new Set()));
      set.add(on);
      return () => void set!.delete(on);
    };

    slots.set(ROOT, { def: { name: ROOT, merge: "one", doc: "The whole UI: a shell fills it." }, pack: "renderer" });

    ctx.provide<SlotDeclare>("slot.declare", (caller, from) => ({
      declare(def): Dispose {
        if (def.name === ROOT || !def.name.startsWith(`${caller.pack}.`)) {
          throw new Refused({ code: "slot.name_outside", message: `${caller.pack} may only declare slots named ${caller.pack}.…`, by: { pack: "renderer" } });
        }
        if (slots.has(def.name)) throw new Refused({ code: "slot.name_taken", message: `${def.name} is already declared.`, by: { pack: "renderer" } });
        return from.effect(() => {
          slots.set(def.name, { def, pack: caller.pack });
          changed(def.name);
          return () => {
            slots.delete(def.name);
            changed(def.name);
          };
        });
      },
    }));

    ctx.provide<SlotFill>("slot.fill", (caller, from) => ({
      fill(def): Dispose {
        return from.effect(() => {
          const f = { def, caller, n: n++ };
          fills.push(f);
          changed(def.slot);
          return () => {
            const i = fills.indexOf(f);
            if (i >= 0) fills.splice(i, 1);
            changed(def.slot);
          };
        });
      },
    }));

    ctx.provide<SlotRead>("slot.read", (_caller, from) => ({
      fills: fillsOf,
      slots: () => [...slots.values()].map((s) => ({ ...s.def, pack: s.pack })),
      watch: (slot, on) => from.effect(() => watch(slot, on)),
    }));

    const Root = () => {
      const [, tick] = useState(0);
      useEffect(() => {
        const stop = watch(ROOT, () => tick((x) => x + 1));
        tick((x) => x + 1); // a fill that came before this effect ran
        return stop;
      }, []);
      const [fill] = fillsOf(ROOT);
      return fill ? h(fill.view, {}) : null;
    };

    ctx.effect(() => {
      const el = document.querySelector(config.mount ?? "#app");
      if (!el) throw new Error(`renderer: nothing matches ${config.mount ?? "#app"}`);
      render(h(Root, {}), el);
      return () => render(null, el);
    });
  },
};

export default renderer;
