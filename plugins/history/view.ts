/**
 * The history plugin, page side: the view "Then", what changed on the map
 * between two points in its log (`history.diff`), and an item as it was at
 * each (`history.at`). The log is the truth, so any point it holds can be
 * read back: a change set (`c120`), a time, or a quick pick (an hour ago,
 * today, a week ago).
 *
 * Each item that differs is a row: + made, ~ changed, − gone, its title
 * (a click opens it), each field from its value then to its value after,
 * and the change sets between that touched it. ▸ shows the item whole at
 * both points. People only look here: every call is a read.
 *
 * Declares `history.from` (page): the point the view compares from, so
 * another view can open it at a change ("what changed since this").
 * Injects slot.fill, here.declare, here.read, here.set and action.invoke.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import type { Json } from "../../spec/common.ts";
import type { HereDeclare, HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import { sheet } from "../../spec/style.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import type { Difference } from "./journal.ts";
import { counts, MARK, pickAt, shown, type Quick } from "./then.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const VIEW = "history/then";
export const FROM = "history.from";
/** The view an item opens in: Landscape, home. */
const OPENS_IN = "field/field";
const PAGE = 100;

interface Point {
  seq: number;
  time?: string;
}
interface Diff {
  from: Point;
  to: Point;
  sets: number;
  total: number;
  items: Difference[];
  next?: string;
}

const STYLE = sheet(`
.th { display:flex; flex-direction:column; min-height:0; height:100%; }
.th-head { display:flex; flex-wrap:wrap; gap:var(--space-3) var(--space-4); align-items:center; padding:var(--space-2) var(--space-4); border-bottom:1px solid var(--line); }
.th-head .t { font-weight:var(--bold); }
.th-head label { display:flex; gap:var(--space-2); align-items:center; color:var(--dim); }
.th-in { font:inherit; width:13em; background:var(--control); border:1px solid var(--control-line); color:var(--control-fg); border-radius:var(--radius); padding:0 var(--space-2); }
.th-btn { font:inherit; font-size:var(--text-s); background:var(--control); border:1px solid var(--control-line); color:var(--control-fg); border-radius:var(--radius); padding:0 var(--space-3); cursor:pointer; flex:none; }
.th-btn:hover { border-color:var(--dim); }
.th-btn.on { border-color:var(--pick); color:var(--pick); }
.th-sum { padding:var(--space-2) var(--space-4); color:var(--dim); font-variant-numeric:tabular-nums; border-bottom:1px solid var(--line); }
.th-sum b { color:var(--fg); font-weight:var(--bold); }
.th-body { flex:1; overflow:auto; min-height:0; padding-bottom:var(--space-5); }
.th-it { display:flex; gap:var(--space-3); align-items:baseline; padding:var(--space-2) var(--space-4) 1px; white-space:nowrap; }
.th-fold { font:inherit; background:none; border:0; padding:0; color:var(--dim); cursor:pointer; width:1em; }
.th-fold:hover { color:var(--fg); }
.th-mk { width:1em; text-align:center; flex:none; font-weight:var(--bold); }
.th-mk.made { color:var(--write); } .th-mk.gone { color:var(--failed); } .th-mk.changed { color:var(--pick); }
.th-it .x { cursor:pointer; overflow:hidden; text-overflow:ellipsis; min-width:0; }
.th-it .x:hover { text-decoration:underline; }
.th-it.gone .x { text-decoration:line-through; cursor:default; }
.th-dim { color:var(--dim); }
.th-n { color:var(--dim); font-size:var(--text-s); font-variant-numeric:tabular-nums; overflow:hidden; text-overflow:ellipsis; }
.th-f { display:grid; grid-template-columns:minmax(6em,max-content) minmax(0,max-content) auto minmax(0,1fr); max-width:60em; gap:0 var(--space-3); padding:0 var(--space-4) 0 calc(var(--space-4) + 2.6em); font-size:var(--text-s); }
.th-f > span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.th-f .k { color:var(--dim); }
.th-f .was { color:var(--dim); text-decoration:line-through; }
.th-whole { display:grid; grid-template-columns:1fr 1fr; gap:var(--space-4); margin:var(--space-2) var(--space-4) var(--space-2) calc(var(--space-4) + 2.6em); font-size:var(--text-s); }
.th-whole > div { border:1px solid var(--line); border-radius:var(--radius); padding:var(--space-2) var(--space-3); min-width:0; }
.th-whole .h { color:var(--dim); margin-bottom:var(--space-1); }
.th-whole .r { display:flex; gap:var(--space-3); white-space:nowrap; }
.th-whole .r > span:first-child { color:var(--dim); min-width:6em; }
.th-whole .r > span:last-child { overflow:hidden; text-overflow:ellipsis; }
.th-err { padding:var(--space-3) var(--space-4); color:var(--failed); }
.th-empty { padding:var(--space-4); color:var(--dim); }
.th-more { margin:var(--space-3) var(--space-4); }
`);

const when = (t?: string) => (t ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "the start");
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

const view: Plugin = {
  id: "history",
  about: "What changed on the map between two points in its log, and an item as it was at each.",
  inject: ["slot.fill", "here.declare", "here.read", "here.set", "action.invoke"],
  apply(ctx: Context) {
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    ctx.get<HereDeclare>("here.declare").declare({
      key: FROM,
      scope: "page",
      value: { type: ["string", "number"] },
      doc: "The point the Then view compares from: a seq, c<seq>, or an ISO time.",
    });

    const read = <O extends Json>(action: string, input: Json) =>
      invoke.invoke<O>({ action, input, authority: { of: "human", basis: "looked at in the Then view" }, reason: "Compare the map at two points" });

    const openItem = (id: string) => {
      set.set(KEYS.item, id);
      set.set(KEYS.view, OPENS_IN);
    };

    /** An item whole at both points, read by id when its row opens. */
    const Whole = ({ id, from, to }: { id: string; from: number; to: number }) => {
      const [sides, setSides] = useState<(Record<string, Json> | undefined)[] | string>();
      useEffect(() => {
        let gone = false;
        void Promise.all([from, to].map((at) => read<{ items: { id: string; fields: Record<string, Json> }[] } & Json>("history.at", { at, ids: [id] }))).then((outs) => {
          if (gone) return;
          const bad = outs.find((o) => !o.ok);
          if (bad && !bad.ok) return setSides(`${bad.refused.code}: ${bad.refused.message}`);
          setSides(outs.map((o) => (o.ok ? o.output.items[0]?.fields : undefined)));
        });
        return () => void (gone = true);
      }, [id, from, to]);
      if (typeof sides === "string") return html`<div class="th-err">${sides}</div>`;
      if (!sides) return html`<div class="th-whole"><div class="th-dim">reading…</div></div>`;
      const side = (label: string, f: Record<string, Json> | undefined) => html`
        <div>
          <div class="h">${label}</div>
          ${f
            ? Object.entries(f).map(([k, v]) => html`<div class="r" key=${k}><span>${k}</span><span title=${shown(v, 2000)}>${shown(v, 120)}</span></div>`)
            : html`<div class="th-dim">not on the map</div>`}
        </div>`;
      return html`<div class="th-whole">${side(`at c${from}`, sides[0])}${side(`at c${to}`, sides[1])}</div>`;
    };

    const Row = ({ d, from, to }: { d: Difference; from: number; to: number }) => {
      const [open, setOpen] = useState(false);
      return html`
        <div class=${`th-it ${d.change}`}>
          <button class="th-fold" aria-expanded=${open} title=${open ? "Fold" : "Show the item whole, then and after"} onClick=${() => setOpen(!open)}>${open ? "▾" : "▸"}</button>
          <span class=${`th-mk ${d.change}`} title=${d.change}>${MARK[d.change]}</span>
          <span class="x" title=${d.id} onClick=${() => d.change !== "gone" && openItem(d.id)}>${d.title ?? d.id}</span>
          <span class="th-n">${d.type ?? ""}</span>
          <span class="th-n" title=${`Change sets between that touched it: ${d.changes.join(", ")}`}>${d.changes.slice(0, 4).join(" ")}${d.changes.length > 4 ? " …" : ""}</span>
        </div>
        ${d.change === "changed" &&
        html`<div class="th-f">
          ${d.fields.map(
            (f) => html`<span class="k">${f.field}</span><span class="was" title=${shown(f.before, 2000)}>${shown(f.before)}</span><span class="th-dim">→</span><span title=${shown(f.after, 2000)}>${shown(f.after)}</span>`,
          )}
        </div>`}
        ${open && html`<${Whole} id=${d.id} from=${from} to=${to} />`}
      `;
    };

    const View = () => {
      const [from, setFrom] = useState<string>(() => {
        const v = here.get<Json>(FROM);
        return v === undefined ? pickAt("today", Date.now()) : String(v);
      });
      const [to, setTo] = useState("now");
      const [diff, setDiff] = useState<Diff>();
      const [err, setErr] = useState<string>();
      const [busy, setBusy] = useState(false);
      useEffect(() => here.watch(FROM, (c) => c.value !== undefined && setFrom(String(c.value))) as () => void, []);
      useEffect(() => {
        let gone = false;
        setBusy(true);
        void read<Diff & Json>("history.diff", { from, to: to || "now", limit: PAGE }).then((o) => {
          if (gone) return;
          setBusy(false);
          if (!o.ok) return (setErr(`${o.refused.code}: ${o.refused.message}`), setDiff(undefined));
          setErr(undefined);
          setDiff(o.output);
        });
        return () => void (gone = true);
      }, [from, to]);
      const more = async () => {
        if (!diff?.next) return;
        const o = await read<Diff & Json>("history.diff", { from: diff.from.seq, to: diff.to.seq, limit: PAGE, after: diff.next });
        if (o.ok) setDiff({ ...(o.output as Diff), items: [...diff.items, ...(o.output as Diff).items] });
      };
      const quick = (q: Quick, label: string) => html`<button class="th-btn" onClick=${() => setFrom(pickAt(q, Date.now()))}>${label}</button>`;
      const c = diff ? counts(diff.items) : undefined;
      return html`
        <div class="th">
          <div class="th-head">
            <span class="t">Then</span>
            <label>from <input class="th-in" value=${from} title="c120, a seq, or a time such as 2026-11-20 or 2026-11-20T14:00" onChange=${(e: Event) => setFrom((e.target as HTMLInputElement).value.trim())} /></label>
            ${quick("hour", "an hour ago")}${quick("today", "today")}${quick("week", "a week ago")}
            <label>to <input class="th-in" value=${to} title="now, c120, a seq, or a time" onChange=${(e: Event) => setTo((e.target as HTMLInputElement).value.trim() || "now")} /></label>
            ${busy && html`<span class="th-dim">reading the log…</span>`}
          </div>
          ${diff &&
          html`<div class="th-sum" title="Both points are read back from the log, which is the truth: the map's tables are its projection">
            c${diff.from.seq} (${when(diff.from.time)}) → c${diff.to.seq} (${when(diff.to.time)}) ·
            <b>${plural(diff.sets, "change set")}</b> · <b>${plural(diff.total, "item")}</b> differ${c && diff.total ? ` · + ${c.made} ~ ${c.changed} − ${c.gone}${diff.next ? " in the first page" : ""}` : ""}
          </div>`}
          <div class="th-body">
            ${err && html`<div class="th-err">${err}</div>`}
            ${diff && diff.total === 0 && html`<div class="th-empty">Nothing differs between these two points.</div>`}
            ${diff?.items.map((d) => html`<${Row} key=${d.id} d=${d} from=${diff.from.seq} to=${diff.to.seq} />`)}
            ${diff?.next && html`<button class="th-btn th-more" onClick=${() => void more()}>more items</button>`}
          </div>
        </div>
      `;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "center", name: "then", title: "Then", view: View });
  },
};

export default view;
