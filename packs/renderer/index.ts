/**
 * The renderer pack: the one copy of Preact every pack's components run on,
 * and the slot broker (spec/slot.md). Provides slot.declare, slot.fill and
 * slot.read, declares `root` and the six regions (spec/frame.md), and mounts
 * the fill of `root` into the page. A fill's `when` is read from `here`;
 * `config.arrange` moves or hides fills. Unloading it unmounts everything.
 *
 * Packs write components with htm over the same Preact the page's import
 * map names, so there is no build step and one copy.
 */
import { Fragment, h, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Caller, Dispose, Json } from "../../spec/common.ts";
import { Refused, byPosition } from "../../spec/common.ts";
import type { HereRead } from "../../spec/here.ts";
import type { Arrange, FillDef, FillInfo, SlotDeclare, SlotDef, SlotFill, SlotRead } from "../../spec/slot.ts";
import { REGIONS, ROOT, fillKey } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";

export interface RendererConfig {
  /** Where to mount, a CSS selector. Default `#app`. */
  mount?: string;
  /** Where fills show: `pack/name` to a region or slot, or `"off"` (spec/frame.md). */
  arrange?: Arrange;
}

const renderer: Pack<RendererConfig> = {
  id: "renderer",
  about: "Draws the page's views.",
  inject: ["here.read"],
  apply(ctx: Context, config: RendererConfig = {}) {
    const here = ctx.get<HereRead>("here.read");
    const arrange = config.arrange ?? {};
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
    /** Where a fill shows: its slot, unless `arrange` moves it; undefined when arranged off. */
    const slotOf = (f: (typeof fills)[number]): string | undefined => {
      const to = arrange[fillKey({ pack: f.caller.pack, name: f.def.name })];
      return to === "off" ? undefined : (to ?? f.def.slot);
    };
    const matches = (when: Record<string, Json> | undefined) =>
      !when ||
      Object.entries(when).every(([key, want]) => {
        const now = here.get(key);
        return want === true ? now !== undefined && now !== null && now !== "" : JSON.stringify(now) === JSON.stringify(want);
      });
    const fillsOf = (slot: string): (FillDef & FillInfo)[] => {
      const s = slots.get(slot);
      if (!s) return [];
      const list = fills
        .filter((f) => slotOf(f) === slot && matches(f.def.when))
        .sort((a, b) => byPosition(a.caller, b.caller) || a.n - b.n)
        .map((f) => ({ ...f.def, pack: f.caller.pack }));
      return s.def.merge === "one" ? list.slice(0, 1) : list;
    };
    /** The `here` keys some fill's `when` reads, each watched once: a change redraws the slots those fills are in. */
    const heard = new Map<string, Dispose>();
    const hear = (key: string) => {
      if (heard.has(key)) return;
      heard.set(
        key,
        here.watch(key, () => {
          const touched = new Set(fills.filter((f) => f.def.when && key in f.def.when).map(slotOf));
          for (const slot of touched) if (slot) changed(slot);
        }),
      );
    };
    const watch = (slot: string, on: () => void) => {
      let set = watchers.get(slot);
      if (!set) watchers.set(slot, (set = new Set()));
      set.add(on);
      return () => void set!.delete(on);
    };

    slots.set(ROOT, { def: { name: ROOT, merge: "one", doc: "The whole UI: a frame fills it." }, pack: "renderer" });
    for (const name of REGIONS) slots.set(name, { def: { name, merge: "many", doc: `The page's ${name} region (spec/frame.md).` }, pack: "renderer" });

    ctx.provide<SlotDeclare>("slot.declare", (caller, from) => ({
      declare(def): Dispose {
        if (def.name === ROOT || (REGIONS as readonly string[]).includes(def.name) || !def.name.startsWith(`${caller.pack}.`)) {
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
          for (const key of Object.keys(def.when ?? {})) hear(key);
          const at = slotOf(f);
          if (at) changed(at);
          return () => {
            const i = fills.indexOf(f);
            if (i >= 0) fills.splice(i, 1);
            if (at) changed(at);
          };
        });
      },
    }));

    /** The shared Slot: a slot's fills in order, redrawn when they change. */
    const Slot = ({ name }: { name: string }) => {
      const [, tick] = useState(0);
      useEffect(() => {
        const stop = watch(name, () => tick((x) => x + 1));
        tick((x) => x + 1); // a fill that came before this effect ran
        return stop;
      }, [name]);
      return h(
        Fragment,
        {},
        fillsOf(name).map((f) => h(f.view, { key: fillKey(f) })),
      );
    };

    ctx.provide<SlotRead>("slot.read", (_caller, from) => ({
      fills: fillsOf,
      Slot,
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
      if (typeof document === "undefined") return () => {}; // no page (a test): nothing to mount
      const el = document.querySelector(config.mount ?? "#app");
      if (!el) throw new Error(`renderer: nothing matches ${config.mount ?? "#app"}`);
      render(h(Root, {}), el);
      return () => {
        render(null, el);
        for (const stop of heard.values()) void stop();
        heard.clear();
      };
    });
  },
};

export default renderer;
