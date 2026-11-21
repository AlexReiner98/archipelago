/**
 * The interchange pack: a graph moved in by the interchange format
 * (packs/graph/interchange.ts) goes through the write chain like any other
 * change. `interchange.import` takes one change set's facts and writes them
 * as one change set of its own, so the schema checks it, the journal keeps
 * it with who moved it and on whose authority, and `history.undo` takes it
 * back.
 *
 * Injects `action.register`. Node and browser alike, though only a script
 * or an agent with a whole set in hand has a use for it.
 */
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { Context, Pack } from "../../runtime/core.ts";

/** The most facts one import takes: a set bigger than this is split by whoever moves it. */
export const FACTS_MAX = 20_000;

const isFact = (f: Json): f is Fact =>
  Array.isArray(f) && f.length === 4 && (f[0] === "+" || f[0] === "-") && typeof f[1] === "string" && !!f[1] && typeof f[2] === "string" && !!f[2];

const interchange: Pack = {
  id: "interchange",
  about: "Brings in a whole map from elsewhere, as one change that can be undone.",
  inject: ["action.register"],
  apply(ctx: Context) {
    ctx.get<ActionRegister>("action.register").register({
      name: "interchange.import",
      title: "Move a change set in from elsewhere",
      doc: "Writes the facts of one change set from the interchange format as one change set here. The schema checks it; history.undo takes it back.",
      input: {
        type: "object",
        properties: { facts: { type: "array", description: "[op, id, field, value], op + or -" } },
        required: ["facts"],
      },
      async run(input: { facts: Json[] }, call: ActionContext) {
        const facts = Array.isArray(input.facts) ? input.facts : [];
        const bad = facts.findIndex((f) => !isFact(f));
        if (!facts.length || bad >= 0) {
          throw new Refused({
            code: "interchange.facts",
            message: facts.length ? `Fact ${bad + 1} is not [op, id, field, value] with op + or -.` : "Give the facts to import.",
            by: { pack: "interchange" },
          });
        }
        if (facts.length > FACTS_MAX) {
          throw new Refused({ code: "interchange.too_big", message: `At most ${FACTS_MAX} facts an import; split the set.`, by: { pack: "interchange" } });
        }
        call.write(facts as Fact[]);
        return { facts: facts.length };
      },
    });
  },
};

export default interchange;
