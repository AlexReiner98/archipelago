/**
 * The actor base (spec/types.md): someone who acts, a person or an agent.
 */
import type { BaseDef, TypesDefine, TypesMark } from "../../spec/types.ts";
import type { Context, Plugin } from "../../runtime/core.ts";

export const ACTOR: BaseDef = {
  name: "actor",
  doc: "Someone who acts.",
  statuses: { open: ["active"], closed: ["inactive"] },
  fields: {
    kind: { kind: "choice", values: ["person", "agent"] },
  },
};

const actor: Plugin = {
  id: "actor",
  about: "Actors: the people and agents who work on the map.",
  inject: ["types.define", "types.mark"],
  apply(ctx: Context) {
    ctx.get<TypesDefine>("types.define").base(ACTOR);
    // Edition 10: drawn as a triangle wherever its marks are.
    ctx.get<TypesMark>("types.mark").mark(ACTOR.name, "triangle");
  },
};

export default actor;
