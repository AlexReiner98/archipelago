/**
 * The map's five kinds of link (spec/types.md). A grouping is a link,
 * never a field.
 */
import type { LinkDef, TypesDefine } from "../../spec/types.ts";
import type { Context, Pack } from "../../runtime/core.ts";

export const LINKS: LinkDef[] = [
  { name: "part_of", doc: "A piece of something larger." },
  { name: "depends_on", doc: "Can't finish until the other has." },
  { name: "waits_on", doc: "Someone has to act first.", to: ["actor"], fields: { for: { kind: "text", doc: "What for." } } },
  { name: "bears_on", doc: "Evidence or an option for a question.", to: ["question"] },
  { name: "about", doc: "Tells about the other." },
];

const links: Pack = {
  id: "links",
  inject: ["types.define"],
  apply(ctx: Context) {
    const define = ctx.get<TypesDefine>("types.define");
    for (const l of LINKS) define.link(l);
  },
};

export default links;
