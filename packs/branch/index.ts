/**
 * The branch flavour (spec/types.md): work done on a git branch, a lane of
 * parallel work or the integration that merges lanes. A flavour of work on
 * trial: it adds fields, never statuses, and is kept by its record. `kind`
 * says which (lane, integration).
 */
import type { FlavourDef, TypesDefine } from "../../spec/types.ts";
import type { Context, Pack } from "../../runtime/core.ts";

export const BRANCH: FlavourDef = {
  name: "branch",
  base: "work",
  doc: "Work done on a git branch: a lane, or the integration that merges lanes.",
  trial: true,
  fields: {
    branch: { kind: "text", doc: "The git branch." },
    head: { kind: "text", doc: "The commit it stands at." },
    files: { kind: "json", doc: "The paths or globs it may touch." },
    checks: { kind: "text", doc: "What was checked, at which commit, and how it went." },
    pr: { kind: "text", doc: "Its pull request." },
  },
};

const branch: Pack = {
  id: "branch",
  inject: ["types.define"],
  apply(ctx: Context) {
    ctx.get<TypesDefine>("types.define").flavour(BRANCH);
  },
};

export default branch;
