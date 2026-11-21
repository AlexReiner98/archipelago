/**
 * The switch pack, page side: an on/off switch on each card of the Packs
 * view, a fill of the docs pack's `docs.card.head`. It turns every entry
 * of the card (page and server) on or off through `switch.set`, as one
 * change set, and offers that change's undo (`history.undo`) beside it.
 *
 * Before you turn one off it says what else stops: the cards that stand on
 * it (ties.ts). What the Packs view and the switch themselves stand on has
 * no switch: turning it off here would stop the way back.
 */
import { h } from "preact";
import { useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import { UNDO } from "../../spec/action.ts";
import type { SlotFill } from "../../spec/slot.ts";
import { sheet } from "../../spec/style.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import type { PackDoc } from "../docs/read.ts";
import { needed, plan, stops } from "./ties.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

const SET = "switch.set";

const SHEET = sheet(`
.sw { position:relative; display:inline-flex; align-items:center; gap:var(--space-2); font-size:var(--text-s); }
.sw-undo { color:var(--pick); background:none; border:0; padding:0; font:inherit; cursor:pointer; }
.sw-undo:hover { text-decoration:underline; }
.sw-t { width:28px; height:16px; border-radius:8px; border:1px solid var(--control-line); background:var(--control); padding:0; cursor:pointer; position:relative; flex:none; }
.sw-t::after { content:""; position:absolute; top:2px; left:2px; width:10px; height:10px; border-radius:50%; background:var(--dim); transition:left .12s; }
.sw-t[aria-checked="true"] { background:var(--pick); border-color:var(--pick); }
.sw-t[aria-checked="true"]::after { left:14px; background:var(--panel); }
.sw-t:disabled { opacity:.5; cursor:default; }
.sw-lock { color:var(--quiet); }
.sw-tip { display:none; position:absolute; right:0; top:calc(100% + 4px); z-index:5; width:220px; padding:var(--space-1) var(--space-2); background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); color:var(--fg); font-size:var(--text-s); box-shadow:0 2px 8px rgb(0 0 0 / .12); }
.sw:hover .sw-tip, .sw:focus-within .sw-tip { display:block; }
.sw-tip b { font-weight:var(--bold); }
.sw-err { color:var(--failed); }
`);

/** The newest change each card's switch made, by card: its undo stays beside it. */
const made = new Map<string, string>();

const sw: Pack = {
  id: "switch",
  about: "Turns a pack on or off, on the page and the server, as a change that can be undone.",
  inject: ["action.invoke", "slot.fill"],
  apply(ctx: Context) {
    const invoke = ctx.get<ActionInvoke>("action.invoke");

    const Switch = ({ pack, all }: { pack: PackDoc; all: PackDoc[] }) => {
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState("");
      const [, tick] = useState(0);
      const entries = pack.entries ?? [];
      if (!entries.length) return null;
      const on = entries.some((e) => !e.off);
      if (on && needed(all).has(pack.id)) {
        return html`<span class="sw" tabindex="0"><span class="sw-lock">needed</span>
          <span class="sw-tip">The Packs view or its undo stands on it, so it stays on here.</span></span>`;
      }
      const stopping = on ? stops(pack.id, all) : [];
      const flip = async () => {
        setBusy(true);
        setErr("");
        const out = await invoke.invoke({
          action: SET,
          input: plan(entries, !on),
          authority: { of: "human", basis: "the switch in the Packs view" },
          reason: `Turned ${pack.id} ${on ? "off" : "on"} in the Packs view`,
        });
        setBusy(false);
        if (!out.ok) return setErr(out.refused.message);
        if (out.change) made.set(pack.id, out.change);
        tick((x) => x + 1);
      };
      const undo = async () => {
        const change = made.get(pack.id)!;
        const out = await invoke.invoke({
          action: UNDO,
          input: { change },
          authority: { of: "human", basis: "undo beside the switch in the Packs view" },
          reason: `Undid turning ${pack.id} ${on ? "on" : "off"}`,
        });
        if (!out.ok) return setErr(out.refused.message);
        made.delete(pack.id);
        tick((x) => x + 1);
      };
      return html`<span class="sw">
        ${made.has(pack.id) && html`<button class="sw-undo" onClick=${undo}>undo</button>`}
        ${err && html`<span class="sw-err" title=${err}>refused</span>`}
        <button class="sw-t" role="switch" aria-checked=${on ? "true" : "false"} aria-label=${`${pack.id} ${on ? "on" : "off"}`} disabled=${busy} onClick=${flip}></button>
        <span class="sw-tip">${
          on
            ? stopping.length
              ? html`Turning it off also stops <b>${stopping.join(", ")}</b>.`
              : "Nothing else stands on it."
            : "Off. Turn it on."
        }</span>
      </span>`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = SHEET;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "docs.card.head", name: "switch", view: Switch as any });
  },
};

export default sw;
