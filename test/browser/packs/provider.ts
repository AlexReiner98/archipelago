/** Fixture: provides `demo.greet`, a word from another module. */
import type { Context } from "../../../runtime/core.ts";
import { word } from "./word.ts";

export default {
  id: "provider",
  apply(ctx: Context) {
    ctx.provide("demo.greet", (caller) => `${word}, ${caller.pack}`);
  },
};
