/** Fixture: injects `demo.greet` and shows it on the page while it is loaded. */
import type { Context } from "../../../runtime/core.ts";

export default {
  id: "consumer",
  inject: ["demo.greet"],
  apply(ctx: Context) {
    const el = document.createElement("p");
    el.className = "greeting";
    el.textContent = `${ctx.get<string>("demo.greet")}!`;
    ctx.effect(() => {
      document.getElementById("out")!.append(el);
      return () => el.remove();
    });
  },
};
