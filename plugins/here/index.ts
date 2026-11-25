/**
 * The here plugin: what is being looked at, now (spec/here.md). Provides
 * here.declare, here.read and here.set, for one page: every key is held
 * in memory and gone with the page. The spec's four keys are declared from
 * the start; a plugin declares any others under its own id.
 */
import type { Dispose, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { Change, HereDeclare, HereRead, HereSet, KeyDef } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { Context, Plugin } from "../../runtime/core.ts";

const here: Plugin = {
  id: "here",
  about: "Remembers what you are looking at, so every view can follow it.",
  apply(ctx: Context) {
    const defs = new Map<string, KeyDef>(Object.values(KEYS).map((key) => [key, { key, scope: "page" }]));
    const values = new Map<string, Json>();
    const watchers = new Map<string, Set<(c: Change) => void>>();
    let last = new Map<string, Change>();

    const tell = (change: Change) => {
      last.set(change.key, change);
      for (const on of [...(watchers.get(change.key) ?? [])]) {
        try {
          on(change);
        } catch (err) {
          ctx.runtime.report(ctx.fiber, err);
        }
      }
    };

    ctx.provide<HereDeclare>("here.declare", (caller, from) => ({
      declare(def): Dispose {
        if (!def.key.startsWith(`${caller.plugin}.`)) {
          throw new Refused({ code: "here.key_outside", message: `${caller.plugin} may only declare keys named ${caller.plugin}.…`, by: { plugin: "here" } });
        }
        if (defs.has(def.key)) throw new Refused({ code: "here.key_taken", message: `${def.key} is already declared.`, by: { plugin: "here" } });
        return from.effect(() => {
          defs.set(def.key, def);
          return () => {
            defs.delete(def.key);
            values.delete(def.key);
            last.delete(def.key);
          };
        });
      },
    }));

    ctx.provide<HereRead>("here.read", (_caller, from) => ({
      get: <T extends Json>(key: string) => values.get(key) as T | undefined,
      watch(key, on): Dispose {
        return from.effect(() => {
          let set = watchers.get(key);
          if (!set) watchers.set(key, (set = new Set()));
          set.add(on);
          on(last.get(key) ?? { key, value: values.get(key), by: { plugin: "here" } });
          return () => set!.delete(on);
        });
      },
    }));

    ctx.provide<HereSet>("here.set", (caller) => ({
      set(key, value) {
        if (!defs.has(key)) throw new Refused({ code: "here.key_unknown", message: `${key} isn't declared.`, by: { plugin: "here" } });
        if (JSON.stringify(values.get(key)) === JSON.stringify(value)) return;
        if (value === undefined) values.delete(key);
        else values.set(key, value);
        tell({ key, value, by: { plugin: caller.plugin, ...(caller.actor ? { actor: caller.actor } : {}) } });
      },
    }));

    ctx.effect(() => () => {
      last = new Map();
      watchers.clear();
    });
  },
};

export default here;
