/**
 * The record base (spec/types.md): something that is so. Current until
 * superseded. A finding is a record with a value.
 */
import type { BaseDef, TypesDefine, TypesMark } from "../../spec/types.ts";
import type { Context, Pack } from "../../runtime/core.ts";

export const RECORD: BaseDef = {
  name: "record",
  doc: "Something that is so.",
  statuses: { open: ["current"], closed: ["superseded"] },
  fields: {
    kind: { kind: "text", doc: "A sort of record (finding, note), before it earns a flavour." },
    value: { kind: "json", doc: "The fact, when it is one value." },
    unit: { kind: "text" },
    as_of: { kind: "date" },
    published: { kind: "boolean", doc: "Stood by, for others to read." },
  },
};

const record: Pack = {
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
