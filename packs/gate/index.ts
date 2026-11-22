/**
 * The gate pack, server side: tells the page whether this server has a
 * gate, and where it answers (offer.ts). Off unless config names `at`: a
 * map on one person's machine has no one to let in, so it has none.
 *
 * Config: `at`, a path on the page's origin that answers the gate (a
 * host's gateway in front of the map). Registers `gate.setup`: `{ at }`,
 * or `{}` when off. It holds and checks nothing.
 *
 * Injects action.register.
 */
import type { ActionRegister } from "../../spec/action.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { local } from "./offer.ts";

export interface GateConfig {
  at?: string;
}

export const SETUP = "gate.setup";

const gate: Pack = {
  id: "gate",
  about: "A host's way in to its maps (sign in, sign up, keep a guest's map), answered at a path the host names. Off unless config names one.",
  inject: ["action.register"],
  apply(ctx: Context, config: GateConfig = {}) {
    const at = config.at?.startsWith("#") ? undefined : local(config.at);
    ctx.get<ActionRegister>("action.register").register({
      name: SETUP,
      title: "Where this server's gate answers",
      doc: "The path the page asks what to offer at sign-in and sign-up; empty when the server has no gate.",
      input: { type: "object" },
      async run() {
        return at ? { at } : {};
      },
    });
  },
};

export default gate;
