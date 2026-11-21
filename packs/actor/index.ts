/**
 * The actor base (spec/types.md): someone who acts, a person or an agent.
 */
import type { BaseDef, TypesDefine } from "../../spec/types.ts";
import type { Context, Pack } from "../../runtime/core.ts";

export const ACTOR: BaseDef = {
  name: "actor",
  doc: "Someone who acts.",
  statuses: { open: ["active"], closed: ["inactive"] },
  fields: {
    kind: { kind: "choice", values: ["person", "agent"] },
  },
};

const actor: Pack = {
  id: "actor",
  about: "Actors: the people and agents who work on the map.",
  inject: ["types.define"],
  apply(ctx: Context) {
    ctx.get<TypesDefine>("types.define").base(ACTOR);
  },
};

export default actor;
