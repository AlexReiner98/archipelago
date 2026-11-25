/**
 * The page plugin, page side: keeps the page's plugins as the `page` item says.
 * It reads the item from the page's copy of the map (`find.index`), lays
 * its changes over the tree the page started with (`loader.tree` base),
 * and edits the tree when the result differs. Undo the change on the map
 * and the page follows. It never decides a change: `page.set` does.
 */
import type { LoaderTree } from "../../spec/loader.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import type { FindIndex } from "../find/index.ts";
import { fieldNow } from "../graph/renamed.ts";
import { overlay, TYPE, type Changes } from "./overlay.ts";

const page: Plugin = {
  id: "page",
  about: "Turns the page's plugins on and off, as a change that can be undone.",
  inject: ["find.index", "loader.tree"],
  apply(ctx: Context) {
    const index = ctx.get<FindIndex>("find.index");
    const loader = ctx.get<LoaderTree>("loader.tree");
    let last = "";
    const follow = () => {
      if (!index.ready()) return;
      const row = index.run(`type:${TYPE}`, 1).items[0];
      const changes = (fieldNow(row?.fields, "plugins") ?? {}) as unknown as Changes;
      const key = JSON.stringify(changes);
      if (key === last) return;
      last = key;
      const next = overlay(loader.base(), changes);
      if (JSON.stringify(next) !== JSON.stringify(loader.tree())) void loader.edit(() => next);
    };
    ctx.effect(() => index.watch(follow) as () => void);
    follow();
  },
};

export default page;
