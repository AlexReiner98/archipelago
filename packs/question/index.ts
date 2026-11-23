/**
 * The question base (spec/types.md): something to decide. Open until
 * decided or dropped. A decision is a question with its outcome.
 */
import type { BaseDef, TypesDefine, TypesMark } from "../../spec/types.ts";
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
  about: "Questions: what is still to be decided, and what was.",
  inject: ["types.define", "types.mark"],
  apply(ctx: Context) {
    ctx.get<TypesDefine>("types.define").base(QUESTION);
    // Edition 10: drawn as a diamond wherever its marks are.
    ctx.get<TypesMark>("types.mark").mark(QUESTION.name, "diamond");
  },
};

export default question;
