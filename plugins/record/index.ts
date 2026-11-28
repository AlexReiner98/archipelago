/**
 * The record base (spec/types.md): something that is so. Current until
 * superseded. A finding is a record with a value.
 *
 * `as_of` and `valid_to` are world time: when it was so, not when the map
 * learned it (that is the log's, history.at). A record of a past job stays
 * current with a `valid_to`; superseded says the map no longer stands by it.
 */
import type { BaseDef, TypesDefine, TypesMark } from "../../spec/types.ts";
import type { Context, Plugin } from "../../runtime/core.ts";

export const RECORD: BaseDef = {
  name: "record",
  doc: "Something that is so.",
  statuses: { open: ["current"], closed: ["superseded"] },
  fields: {
    kind: { kind: "text", doc: "A sort of record (finding, note), before it earns a flavour." },
    value: { kind: "json", doc: "The fact, when it is one value." },
    unit: { kind: "text" },
    as_of: { kind: "date", doc: "When it became so in the world (not when the map learned it)." },
    valid_to: { kind: "date", doc: "When it stopped being so in the world; absent, it still is." },
    published: { kind: "boolean", doc: "Stood by, for others to read." },
  },
};

const record: Plugin = {
  id: "record",
  about: "Records: what was found, said or decided.",
  inject: ["types.define", "types.mark"],
  apply(ctx: Context) {
    ctx.get<TypesDefine>("types.define").base(RECORD);
    // Edition 10: drawn as a circle wherever its marks are.
    ctx.get<TypesMark>("types.mark").mark(RECORD.name, "circle");
  },
};

export default record;
