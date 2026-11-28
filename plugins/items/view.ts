/**
 * The items plugin, page side: a merge on the item page, in its slot
 * `item.actions`. "merge…" opens a find for the item's twin (same type,
 * by words in its title); picking one shows both side by side and what the
 * merge would do, worked out by the same `mergeFacts` the action runs:
 * which item stays, which goes, the links that move to the one kept or go
 * (a duplicate, or one that would tie it to itself), and each field that
 * differs with the value that stays. Merge runs `items.merge` as the
 * person at the page; its undo is in the item's history and the Activity
 * view.
 *
 * Injects find.index, here.read, here.set, slot.fill, action.invoke.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import type { Id, Json } from "../../spec/common.ts";
import type { HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { Link } from "../../spec/graph.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { TypeInfo } from "../../spec/types.ts";
import { sheet } from "../../spec/style.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { mergeFacts, type MergeReport } from "./index.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

interface Row {
  id: Id;
  type: string;
  fields: Record<string, Json>;
}
interface Wire extends Row {
  from: Id;
  to: Id;
}
/** What this reads of `find.index` (the find plugin's own key). */
interface FindIndex {
  item(id: Id): Row | undefined;
  linksOf(id: Id): Wire[];
  type(name: string): TypeInfo | undefined;
  run(query: string, limit?: number): { items: Row[] };
  watch(on: () => void): () => void;
}

/** What a merge of `drop` into `keep` would do, for the confirm: the action's own report, and each field that differs. */
export interface Preview extends MergeReport {
  /** A field both hold with different values: whose stays. */
  differ: { field: string; keep: Json; drop: Json }[];
}

const asLink = (w: Wire): Link => ({ id: w.id, type: w.type, from: w.from, to: w.to, fields: { ...w.fields, from: w.from, to: w.to } });

/** The merge worked out on what the page holds, without writing anything. */
export function preview(keep: Row, drop: Row, t: TypeInfo, keepLinks: Wire[], dropLinks: Wire[]): Preview {
  const { report } = mergeFacts(
    { id: keep.id, type: keep.type, fields: keep.fields },
    { id: drop.id, type: drop.type, fields: drop.fields },
    t,
    dropLinks.map(asLink),
    keepLinks.map(asLink),
    {},
  );
  const differ = Object.keys(drop.fields)
    .filter((f) => keep.fields[f] !== undefined && JSON.stringify(keep.fields[f]) !== JSON.stringify(drop.fields[f]))
    .map((f) => ({ field: f, keep: keep.fields[f]!, drop: drop.fields[f]! }));
  return { ...report, differ };
}

/** The words to look for a twin by: the title's longest word. */
export function twinWords(title: string): string {
  return [...title.toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)].map((m) => m[0]).sort((a, b) => b.length - a.length)[0] ?? "";
}

const STYLE = sheet(`
.im { width:100%; border:1px solid var(--line); border-radius:var(--radius); padding:var(--space-3); display:flex; flex-direction:column; gap:var(--space-2); font-size:var(--text-s); }
.im input { font:inherit; background:var(--control); border:1px solid var(--control-line); color:var(--control-fg); border-radius:var(--radius); padding:var(--space-1) var(--space-2); }
.im-hit { display:flex; gap:var(--space-2); cursor:pointer; padding:1px var(--space-2); border-radius:var(--radius); background:none; border:0; font:inherit; color:inherit; text-align:left; }
.im-hit:hover { background:var(--pick); }
.im-two { display:grid; grid-template-columns:1fr 1fr; gap:var(--space-3); }
.im-side { border-left:2px solid var(--line); padding-left:var(--space-2); min-width:0; }
.im-side.keep { border-color:var(--mark-done); }
.im-side.drop { border-color:var(--mark-gone); }
.im-side .t { font-weight:var(--bold); overflow:hidden; text-overflow:ellipsis; }
.im-say { margin:0; padding-left:1.2em; }
.im-row { display:flex; gap:var(--space-2); align-items:center; }
.im-dim { color:var(--dim); }
.im-no { color:var(--failed); }
`);

const items: Plugin = {
  id: "items",
  about: "Merges two items for one thing, from the item page, with a confirm that says what keeps and what goes.",
  inject: ["find.index", "here.read", "here.set", "slot.fill", "action.invoke"],
  apply(ctx: Context) {
    const index = ctx.get<FindIndex>("find.index");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    const invoke = ctx.get<ActionInvoke>("action.invoke");

    const Merge = () => {
      const [, tick] = useState(0);
      useEffect(() => index.watch(() => tick((x) => x + 1)) as () => void, []);
      const [id, setId] = useState<Id | undefined>(here.get<Id>(KEYS.item));
      useEffect(() => here.watch(KEYS.item, (c) => setId(c.value as Id | undefined)) as () => void, []);
      const [open, setOpen] = useState(false);
      const [words, setWords] = useState<string | undefined>();
      const [other, setOther] = useState<Id | undefined>();
      const [swap, setSwap] = useState(false);
      const [said, setSaid] = useState<string | undefined>();
      useEffect(() => (setOpen(false), setOther(undefined), setWords(undefined), setSwap(false)), [id]);
      const row = id ? index.item(id) : undefined;
      if (!row || typeof row.fields.from === "string") return null;
      if (!open) return html`<button class="ip-btn" title="Make this and another item for the same thing one" onClick=${() => (setOpen(true), setSaid(undefined))}>merge…</button>${said && html`<span class="im-dim">${said}</span>`}`;
      const close = () => (setOpen(false), setOther(undefined));
      const title = (r: Row) => String(r.fields.title ?? r.id);
      const twin = other ? index.item(other) : undefined;

      if (!twin) {
        const q = words ?? twinWords(title(row));
        const hits = index.run(`type:${row.type} ${q}`, 9).items.filter((r) => r.id !== row.id && typeof r.fields.from !== "string").slice(0, 8);
        return html`<div class="im">
          <div class="im-row"><span>Merge with another ${row.type}:</span><button class="ip-x" style="margin-left:auto" title="Close" onClick=${close}>×</button></div>
          <input value=${q} placeholder="words in its title" onInput=${(e: Event) => setWords((e.target as HTMLInputElement).value)} />
          ${hits.map((r) => html`<button class="im-hit" title=${r.id} onClick=${() => setOther(r.id)}><span>${title(r)}</span><span class="im-dim">${String(r.fields.status ?? "")}</span></button>`)}
          ${!hits.length && html`<span class="im-dim">No other ${row.type} has those words.</span>`}
          ${said && html`<span class="im-dim">${said}</span>`}
        </div>`;
      }

      const [keep, drop] = swap ? [twin, row] : [row, twin];
      const t = index.type(keep.type);
      if (!t) return null;
      const p = preview(keep, drop, t, index.linksOf(keep.id), index.linksOf(drop.id));
      const name = (i: Id) => (i === keep.id ? `“${title(keep)}”` : i === drop.id ? `“${title(drop)}”` : `“${title(index.item(i) ?? { id: i, type: "", fields: {} })}”`);
      const ends = (l: Id) => {
        const w = index.linksOf(drop.id).find((x) => x.id === l);
        return w ? `${w.type.replace(/_/g, " ")} ${w.from === drop.id ? `→ ${name(w.to)}` : `← ${name(w.from)}`}` : l;
      };
      const go = async () => {
        const r = await invoke.invoke({ action: "items.merge", input: { keep: keep.id, drop: drop.id }, authority: { of: "human", basis: "merged on the item page" }, reason: `“${title(drop)}” and “${title(keep)}” are one thing` });
        if (!r.ok) return setSaid(r.refused.message);
        setSaid(`Merged: “${title(drop)}” went into “${title(keep)}”. Its undo is in the history.`);
        setOpen(false);
        setOther(undefined);
        if (drop.id === row.id) set.set(KEYS.item, keep.id);
      };
      const Side = ({ r, role }: { r: Row; role: "keep" | "drop" }) => html`<div class=${`im-side ${role}`}>
        <div class="im-dim">${role === "keep" ? "Stays" : "Goes"}</div>
        <div class="t" title=${r.id}>${title(r)}</div>
        <div class="im-dim">${r.type} · ${String(r.fields.status ?? "")} · ${index.linksOf(r.id).length} links</div>
      </div>`;
      return html`<div class="im">
        <div class="im-row"><span>Merge two items for one thing</span><button class="ip-x" style="margin-left:auto" title="Close" onClick=${close}>×</button></div>
        <div class="im-two"><${Side} r=${keep} role="keep" /><${Side} r=${drop} role="drop" /></div>
        <ul class="im-say">
          ${p.moved.map((l) => html`<li>${ends(l)}: moves to ${name(keep.id)}</li>`)}
          ${p.removed.map((x) => html`<li class="im-dim">${ends(x.id)}: taken away, ${x.why === "self" ? `it would tie ${name(keep.id)} to itself` : `${name(keep.id)} has it already`}</li>`)}
          ${p.took.map((f) => html`<li>${f}: ${name(keep.id)} takes ${name(drop.id)}'s</li>`)}
          ${p.differ.map((d) => html`<li class="im-dim">${d.field}: ${name(keep.id)}'s stays (${JSON.stringify(d.keep).slice(0, 40)}), not ${JSON.stringify(d.drop).slice(0, 40)}</li>`)}
          <li>${name(drop.id)} goes. An undo of the merge brings it back as it was.</li>
        </ul>
        <div class="im-row">
          <button class="ip-btn" onClick=${go}>Merge: keep ${name(keep.id)}</button>
          <button class="ip-btn" title="Keep the other one instead" onClick=${() => setSwap(!swap)}>keep the other</button>
          <button class="ip-btn" onClick=${() => setOther(undefined)}>back</button>
        </div>
        ${said && html`<span class="im-no">${said}</span>`}
      </div>`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "item.actions", name: "merge", title: "Merge", view: Merge });
  },
};

export default items;
