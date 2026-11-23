/**
 * The types pack: the broker of spec/types.md. Provides types.define,
 * types.read and types.mark (edition 10: the shape each base is drawn in). Holds bases, flavours and kinds of link as the defining
 * packs' effects, so each goes when its pack unloads; it knows no type of
 * its own. A flavour is refused when its base isn't there or when it
 * declares a field its base already has.
 */
import type { Caller, Dispose } from "../../spec/common.ts";
import { Refused, byPosition } from "../../spec/common.ts";
import type { BaseDef, FieldDef, FlavourDef, LinkDef, LinkInfo, TypeInfo, TypesDefine, TypesMark, TypesRead } from "../../spec/types.ts";
import { MARK_SHAPES, type MarkShape } from "../../spec/style.ts";
import { COMMON } from "../../spec/types.ts";
import type { Context, Pack } from "../../runtime/core.ts";

type Def = { what: "base"; def: BaseDef } | { what: "flavour"; def: FlavourDef } | { what: "link"; def: LinkDef };

const refuse = (code: string, message: string): never => {
  throw new Refused({ code: `types.${code}`, message, by: { pack: "types" } });
};

const types: Pack = {
  id: "types",
  about: "Keeps the kinds of item and link the map can hold.",
  apply(ctx: Context) {
    const defs = new Map<string, { d: Def; caller: Caller; n: number }>();
    const watchers = new Set<() => void>();
    let n = 0;
    const changed = () => {
      for (const on of [...watchers]) {
        try {
          on();
        } catch (err) {
          ctx.runtime.report(ctx.fiber, err);
        }
      }
    };

    const ordered = () => [...defs.values()].sort((a, b) => byPosition(a.caller, b.caller) || a.n - b.n);
    const baseOf = (name: string) => {
      const e = defs.get(name);
      return e?.d.what === "base" ? e.d.def : undefined;
    };
    const resolve = (e: { d: Def; caller: Caller }): TypeInfo | undefined => {
      if (e.d.what === "base") {
        const b = e.d.def;
        return { name: b.name, base: b.name, statuses: b.statuses, fields: { ...COMMON, ...b.fields }, trial: false, pack: e.caller.pack, ...(b.doc ? { doc: b.doc } : {}) };
      }
      if (e.d.what !== "flavour") return undefined;
      const f = e.d.def;
      const b = baseOf(f.base);
      if (!b) return undefined; // its base went; it comes back with it
      return {
        name: f.name,
        base: b.name,
        statuses: b.statuses,
        fields: { ...COMMON, ...b.fields, ...f.fields },
        trial: f.trial !== false,
        pack: e.caller.pack,
        ...(f.doc ? { doc: f.doc } : {}),
      };
    };

    const add = (caller: Caller, from: Context, d: Def): Dispose => {
      const name = d.def.name;
      if (!name || typeof name !== "string") refuse("name", "A type needs a name.");
      if (defs.has(name)) refuse("name_taken", `${name} is already defined by ${defs.get(name)!.caller.pack}.`);
      return from.effect(() => {
        const e = { d, caller, n: n++ };
        defs.set(name, e);
        changed();
        return () => {
          if (defs.get(name) === e) defs.delete(name);
          changed();
        };
      });
    };

    const checkFields = (fields: Record<string, FieldDef> | undefined, owner: string) => {
      for (const [k, f] of Object.entries(fields ?? {})) {
        if (k in COMMON) refuse("field_common", `${owner}: every base has ${k} already.`);
        if (f.kind === "choice" && !f.values?.length) refuse("field_values", `${owner}.${k} is a choice with no values.`);
      }
    };

    ctx.provide<TypesDefine>("types.define", (caller, from) => ({
      base(def) {
        if (!def.statuses?.open?.length) refuse("statuses", `${def.name} needs at least one open status.`);
        checkFields(def.fields, def.name);
        return add(caller, from, { what: "base", def });
      },
      flavour(def) {
        const b = baseOf(def.base);
        if (!b) refuse("base_unknown", `${def.name} names base ${def.base}, which isn't defined now.`);
        if ("statuses" in (def as object)) refuse("flavour_statuses", `${def.name} is a flavour: it adds fields only, never statuses.`);
        checkFields(def.fields, def.name);
        for (const k of Object.keys(def.fields ?? {})) {
          if (k in b!.fields) refuse("field_taken", `${def.base} already has ${k}: a flavour adds fields, never redefines one.`);
        }
        return add(caller, from, { what: "flavour", def: { ...def, fields: def.fields ?? {} } });
      },
      link(def) {
        checkFields(def.fields, def.name);
        return add(caller, from, { what: "link", def });
      },
    }));

    // Each base's shape, as its pack names it; a base none names takes the first shape left.
    const named = new Map<string, MarkShape>();
    ctx.provide<TypesMark>("types.mark", (_caller, from) => ({
      mark(base, shape) {
        if (!MARK_SHAPES.includes(shape)) refuse("mark_shape", `${shape} is not a mark shape: one of ${MARK_SHAPES.join(", ")}.`);
        if (named.has(base)) refuse("mark_named", `${base} is drawn as a ${named.get(base)} already.`);
        const held = [...named].find(([, s]) => s === shape)?.[0];
        if (held) refuse("mark_held", `${held} is drawn as a ${shape} already.`);
        return from.effect(() => {
          named.set(base, shape);
          changed();
          return () => {
            if (named.get(base) === shape) named.delete(base);
            changed();
          };
        });
      },
      marks() {
        const bases = ordered().filter((e) => e.d.what === "base").map((e) => e.d.def.name);
        const free = MARK_SHAPES.filter((s) => ![...named.values()].includes(s));
        const out: Record<string, MarkShape> = {};
        let k = 0;
        for (const b of bases) out[b] = named.get(b) ?? (k < free.length ? free[k++]! : MARK_SHAPES[k++ % MARK_SHAPES.length]!);
        return out;
      },
      watch(on): Dispose {
        return from.effect(() => {
          watchers.add(on);
          return () => watchers.delete(on);
        });
      },
    }));

    ctx.provide<TypesRead>("types.read", (_caller, from) => ({
      all() {
        const list = ordered();
        const out: TypeInfo[] = [];
        const links: LinkInfo[] = [];
        for (const e of list) {
          if (e.d.what === "link") links.push({ ...e.d.def, pack: e.caller.pack });
          else {
            const t = resolve(e);
            if (t) out.push(t);
          }
        }
        return { types: out, links };
      },
      get(name) {
        const e = defs.get(name);
        if (!e) return undefined;
        return e.d.what === "link" ? { ...e.d.def, pack: e.caller.pack } : resolve(e);
      },
      watch(on): Dispose {
        return from.effect(() => {
          watchers.add(on);
          return () => watchers.delete(on);
        });
      },
    }));
  },
};

export default types;
