/**
 * The switch plugin, page side: an on/off switch on each card of the Plugins
 * view, a fill of the docs plugin's `docs.card.head`. It turns every entry
 * of the card (page and server) on or off through `switch.set`, as one
 * change set. Flipping it back is the undo; activity keeps each change.
 *
 * Before you turn one off it says what else stops: the cards that stand on
 * it (ties.ts). What the Plugins view and the switch themselves stand on has
 * no switch: turning it off here would stop the way back.
 */
import { h } from "preact";
import { useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import type { SlotFill } from "../../spec/slot.ts";
import { sheet } from "../../spec/style.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import type { PluginDoc } from "../docs/read.ts";
import { needed, plan, stops } from "./ties.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

const SET = "switch.set";

const SHEET = sheet(`
.sw { position:relative; display:inline-flex; align-items:center; gap:var(--space-2); font-size:var(--text-s); }
.sw-t { width:28px; height:16px; border-radius:8px; border:1px solid var(--control-line); background:var(--control); padding:0; cursor:pointer; position:relative; flex:none; }
.sw-t::after { content:""; position:absolute; top:2px; left:2px; width:10px; height:10px; border-radius:50%; background:var(--dim); transition:left .12s; }
.sw-t[aria-checked="true"] { background:var(--pick); border-color:var(--pick); }
.sw-t[aria-checked="true"]::after { left:14px; background:var(--panel); }
.sw-t:disabled { opacity:.5; cursor:default; }
.sw-lock { color:var(--quiet); }
.sw-tip { display:none; position:absolute; right:0; top:calc(100% + 4px); z-index:5; width:220px; padding:var(--space-1) var(--space-2); background:var(--bg); border:1px solid var(--dim); border-radius:var(--radius); color:var(--fg); font-size:var(--text-s); box-shadow:0 4px 12px rgb(0 0 0 / .3); }
.sw:hover .sw-tip, .sw:focus-within .sw-tip { display:block; }
.sw-tip b { font-weight:var(--bold); }
.sw-err { color:var(--failed); }
`);

const sw: Plugin = {
  id: "switch",
  about: "Turns a plugin on or off, on the page and the server, as a change that can be undone.",
  inject: ["action.invoke", "slot.fill"],
  apply(ctx: Context) {
    const invoke = ctx.get<ActionInvoke>("action.invoke");

    const Switch = ({ plugin, all }: { plugin: PluginDoc; all: PluginDoc[] }) => {
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState("");
      const entries = plugin.entries ?? [];
      if (!entries.length) return null;
      const on = entries.some((e) => !e.off);
      if (on && needed(all).has(plugin.id)) {
        return html`<span class="sw" tabindex="0"><span class="sw-lock">needed</span>
          <span class="sw-tip">The Plugins view or its undo stands on it, so it stays on here.</span></span>`;
      }
      const stopping = on ? stops(plugin.id, all) : [];
      const flip = async () => {
        setBusy(true);
        setErr("");
        const out = await invoke.invoke({
          action: SET,
          input: plan(entries, !on),
          authority: { of: "human", basis: "the switch in the Plugins view" },
          reason: `Turned ${plugin.id} ${on ? "off" : "on"} in the Plugins view`,
        });
        setBusy(false);
        if (!out.ok) setErr(out.refused.message);
      };
      return html`<span class="sw">
        ${err && html`<span class="sw-err" title=${err}>refused</span>`}
        <button class="sw-t" role="switch" aria-checked=${on ? "true" : "false"} aria-label=${`${plugin.id} ${on ? "on" : "off"}`} disabled=${busy} onClick=${flip}></button>
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
