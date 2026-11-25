/**
 * The views plugin, server side: defines the flavour `view`, so an agent makes
 * a view with `items.create` like any item, and undoes it the same way. The
 * page side (view.ts) lists and applies them.
 */
import type { TypesDefine } from "../../spec/types.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { VIEW } from "./pick.ts";

const views: Plugin = {
  id: "views",
  about: "Views: each one item holding a whole arrangement of the page.",
  inject: ["types.define"],
  apply(ctx: Context) {
    ctx.get<TypesDefine>("types.define").flavour(VIEW);
  },
};

export default views;
