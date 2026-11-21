/**
 * The work base (spec/types.md): something to do. To do and doing are
 * open; done and dropped are closed. Waiting is a `waits_on` link, not a
 * status. Its fields are the ones Focus uses today.
 */
import type { BaseDef, TypesDefine } from "../../spec/types.ts";
import type { Context, Pack } from "../../runtime/core.ts";

export const WORK: BaseDef = {
  name: "work",
  doc: "Something to do.",
  statuses: { open: ["todo", "doing"], closed: ["done", "dropped"] },
  fields: {
    kind: { kind: "text", doc: "A sort of work (bug, chore), before it earns a flavour." },
    priority: { kind: "choice", values: ["low", "normal", "high", "urgent"] },
    due: { kind: "date" },
    seen_working: { kind: "boolean", doc: "Someone has seen what it built working." },
    to_see: { kind: "text", doc: "What would show it working." },
    tokens_estimated: { kind: "number", doc: "Input and output together, not counting cached re-reads." },
    tokens_used: { kind: "number" },
  },
};

const work: Pack = {
  id: "work",
  about: "Work items: tasks and steps, with their status.",
  inject: ["types.define"],
  apply(ctx: Context) {
    ctx.get<TypesDefine>("types.define").base(WORK);
  },
};

export default work;
