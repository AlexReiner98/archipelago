/**
 * The style pack: sets the tokens (spec/style.md) on the page's root, light
 * and dark, from tokens.ts. It needs nothing, and nothing needs it: every
 * view refers to the tokens with a plain fallback, so unloading it leaves
 * the page in the system's own colours and font. Its sheet is its effect;
 * it tells the views each time the tokens come or go.
 */
import { CHANGED } from "../../spec/style.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { css } from "./tokens.ts";

const style: Pack = {
  id: "style",
  about: "The look every view shares: colours, type and marks.",
  apply(ctx: Context) {
    ctx.effect(() => {
      const el = document.createElement("style");
      el.dataset.pack = "style";
      el.textContent = css();
      document.head.prepend(el);
      document.dispatchEvent(new Event(CHANGED));
      return () => {
        el.remove();
        document.dispatchEvent(new Event(CHANGED));
      };
    });
  },
};

export default style;
