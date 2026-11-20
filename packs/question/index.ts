/**
 * The question base (spec/types.md): something to decide. Open until
 * decided or dropped. A decision is a question with its outcome.
 */
import type { BaseDef, TypesDefine } from "../../spec/types.ts";
import type { Context, Pack } from "../../runtime/core.ts";

export const QUESTION: BaseDef = {
  name: "question",
  doc: "Something to decide.",
  statuses: { open: ["open"], closed: ["decided", "dropped"] },
  fields: {
    kind: { kind: "text" },
    options: { kind: "json", doc: "The choices, one line each." },
    outcome: { kind: "text", doc: "What was chosen." },
    rationale: { kind: "text", doc: "Why." },
    decided_on: { kind: "date" },
  },
};

const question: Pack = {
  id: "question",
  inject: ["types.define"],
  apply(ctx: Context) {
    ctx.get<TypesDefine>("types.define").base(QUESTION);
  },
};

export default question;
