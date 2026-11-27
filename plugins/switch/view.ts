/**
 * The switch plugin, page side: an on/off switch on each card of the Plugins
 * view, a fill of the docs plugin's `docs.card.head`. It turns every entry
 * of the card (page and server) on or off through `switch.set`, as one
 * change set. Flipping it back is the undo; activity keeps each change.
 *
 * Before you turn one off it says what else stops: the cards that stand on
 * it (ties.ts), and how many items its kinds hold. Those stay on the graph
 * unchanged when it goes, but no view drawn from the types shows them; an
 * off card says how many it left (`schema.untyped`, read once for every
 * card, again whenever one is turned on or off). What the Plugins view and the switch themselves stand on has
 * no switch: turning it off here would stop the way back.
 *
 * Kinds whose plugin is not loaded at all (deleted, or never seen defined)
 * are no card's, so no switch shows them: they get a list of their own after
 * the cards (a fill of `docs.list`), each with its count and, opened, a page
 * of its items (`schema.untyped` with `type`, PAGE at a time).
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import type { Json } from "../../spec/common.ts";
import type { SlotFill } from "../../spec/slot.ts";
import { sheet } from "../../spec/style.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import type { PluginDoc } from "../docs/read.ts";
import { holds, leftBy, needed, orphans, plan, stops, type Untyped } from "./ties.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

const SET = "switch.set";
/** Items of a kind without a plugin read at a time, when its row is opened. */
export const PAGE = 20;

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
.sw-left { color:var(--moving); white-space:nowrap; }
.sw-gone > h3 { color:var(--moving); }
.sw-rows { border:1px solid var(--line); border-radius:var(--radius); background:var(--panel); padding:var(--space-1) var(--space-3); }
.sw-row { padding:var(--space-1) 0; }
.sw-row + .sw-row { border-top:1px solid var(--line); }
.sw-row > button { background:none; border:0; padding:0; font:inherit; color:var(--pick); cursor:pointer; }
.sw-row > button:hover { text-decoration:underline; }
.sw-row .sw-was { color:var(--dim); margin-left:var(--space-2); }
.sw-items { margin:var(--space-1) 0 0; padding-left:var(--space-4); font-size:var(--text-s); }
.sw-items code { font-family:var(--mono); color:var(--dim); margin-right:var(--space-2); }
.sw-items button { background:none; border:0; padding:0; font:inherit; color:var(--pick); cursor:pointer; }
`);

const sw: Plugin = {
  id: "switch",
  about: "Turns a plugin on or off, on the page and the server, as a change that can be undone.",
  inject: ["action.invoke", "slot.fill"],
  apply(ctx: Context) {
    const invoke = ctx.get<ActionInvoke>("action.invoke");

    // ---------- what is left without its type: one read for every card ----------

    let untyped: Untyped[] = [];
    let readFor: string | undefined;
    const heard = new Set<() => void>();
    /** Reads `schema.untyped` again when the cards' on and off differ from the last read. None there (no schema plugin): nothing is shown. */
    const readUntyped = async (key: string) => {
      if (key === readFor) return;
      readFor = key;
      const out = await invoke.invoke<Json>({
        action: "schema.untyped",
        input: {},
        authority: { of: "human", basis: "looked at in the Plugins view" },
        reason: "What turned-off plugins left without their type",
      });
      if (readFor !== key) return;
      untyped = out.ok ? (out.output as unknown as { types: Untyped[] }).types : [];
      heard.forEach((on) => on());
    };
    const useUntyped = (all: PluginDoc[]) => {
      const [, tick] = useState(0);
      const key = all.map((d) => `${d.id}:${(d.entries ?? []).map((e) => Number(e.off)).join("")}`).join(" ");
      useEffect(() => {
        const on = () => tick((x) => x + 1);
        heard.add(on);
        return () => void heard.delete(on);
      }, []);
      useEffect(() => void readUntyped(key), [key]);
      return untyped;
    };
    const items = (n: number, more = false) => `${n}${more ? "+" : ""} item${n === 1 && !more ? "" : "s"}`;

    const Switch = ({ plugin, all }: { plugin: PluginDoc; all: PluginDoc[] }) => {
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState("");
      const left = leftBy(plugin, useUntyped(all));
      const entries = plugin.entries ?? [];
      if (!entries.length) return null;
      const on = entries.some((e) => !e.off);
      if (on && needed(all).has(plugin.id)) {
        return html`<span class="sw" tabindex="0"><span class="sw-lock">needed</span>
          <span class="sw-tip">The Plugins view or its undo stands on it, so it stays on here.</span></span>`;
      }
      const stopping = on ? stops(plugin.id, all) : [];
      const held = holds(plugin);
      const leftN = left.reduce((n, u) => n + u.items, 0);
      const leftMore = left.some((u) => u.more);
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
        ${!on && leftN > 0 && html`<span class="sw-left">${items(leftN, leftMore)} without a type</span>`}
        <button class="sw-t" role="switch" aria-checked=${on ? "true" : "false"} aria-label=${`${plugin.id} ${on ? "on" : "off"}`} disabled=${busy} onClick=${flip}></button>
        <span class="sw-tip">${
          on
            ? html`${stopping.length ? html`Turning it off also stops <b>${stopping.join(", ")}</b>.` : "Nothing else stands on it."}${
                held.items
                  ? html` Its kinds (${held.kinds.join(", ")}) hold <b>${items(held.items, held.more)}</b>: they stay on the map unchanged, but no view shows them until it is back on.`
                  : ""
              }`
            : leftN
              ? html`Off. <b>${items(leftN, leftMore)}</b> still have its kinds (${left.map((u) => `${u.type} ${u.items}${u.more ? "+" : ""}`).join(", ")}), unchanged, but no view shows them. Turn it on to see them again.`
              : "Off. Turn it on."
        }</span>
      </span>`;
    };

    // ---------- kinds whose plugin is gone: a list after the cards ----------

    type Row = { id: string; title?: string; status?: Json };
    /** One kind without a plugin: its count, and opened, its items a page at a time. */
    const Gone = ({ u }: { u: Untyped }) => {
      const [rows, setRows] = useState<Row[] | undefined>(undefined);
      const [next, setNext] = useState<string | undefined>(undefined);
      const [err, setErr] = useState("");
      const read = async (after?: string) => {
        const out = await invoke.invoke<Json>({
          action: "schema.untyped",
          input: { type: u.type, limit: PAGE, ...(after ? { after } : {}) },
          authority: { of: "human", basis: "looked at in the Plugins view" },
          reason: `The items of ${u.type}, whose plugin is gone`,
        });
        if (!out.ok) return setErr(out.refused.message);
        const page = out.output as unknown as { items: Row[]; next?: string };
        setRows((had) => [...(after ? (had ?? []) : []), ...page.items]);
        setNext(page.next);
      };
      const was = u.plugin ? `last defined by ${u.plugin}, which is not loaded${u.seen ? ` (seen ${u.seen.slice(0, 10)})` : ""}` : "never seen defined here";
      return html`<div class="sw-row" data-type=${u.type}>
        <button onClick=${() => (rows ? setRows(undefined) : void read())} aria-expanded=${rows ? "true" : "false"}>${u.type}</button>
        <span> ${items(u.items, !!u.more)}</span><span class="sw-was">${was}</span>
        ${err && html`<div class="sw-err">${err}</div>`}
        ${rows &&
        html`<ul class="sw-items">
          ${rows.map((r) => html`<li key=${r.id}><code>${r.id}</code>${r.title ?? ""}${r.status !== undefined ? html` <span class="sw-was">${String(r.status)}</span>` : ""}</li>`)}
          ${next && html`<li><button onClick=${() => void read(next)}>${PAGE} more</button></li>`}
        </ul>`}
      </div>`;
    };
    const Gones = ({ all }: { all: PluginDoc[] }) => {
      const gone = orphans(useUntyped(all), all);
      if (!gone.length) return null;
      const n = gone.reduce((s, u) => s + u.items, 0);
      return html`<section class="dk-list sw-gone">
        <h3>Without a plugin<span>${items(n, gone.some((u) => u.more))} of ${gone.length} kind${gone.length === 1 ? "" : "s"} no loaded plugin defines. They stay on the map unchanged, but no view drawn from the types shows them, and no switch here brings them back. A plugin that defines the kind again shows them; schema.untyped lists them.</span></h3>
        <div class="sw-rows">${gone.map((u) => html`<${Gone} key=${u.type} u=${u} />`)}</div>
      </section>`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = SHEET;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "docs.card.head", name: "switch", view: Switch as any });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "docs.list", name: "without-a-plugin", view: Gones as any });
  },
};

export default sw;
