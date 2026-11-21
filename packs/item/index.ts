/**
 * The item pack, page side: one page per item, in the region `right`, for
 * the item `here.item` names. Its mark and title, its fields as marks, its
 * note (the lead shown, sections folded), its neighbours by kind of link,
 * and its history: who changed what and when, each change undoable.
 *
 * It only looks, and undoes. Nobody adds, links or edits items by hand
 * here: agents change the map through the items actions, and the page
 * follows live through `find.index`. Statuses are drawn by their base's
 * sides and fields by kind, never by a type's name. The history is read
 * through the action `history.list` (a page of 10 at a time) and undone
 * through `history.undo`, as the person at the page.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import type { Id, Json } from "../../spec/common.ts";
import type { HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { TypeInfo } from "../../spec/types.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { glyph, onStyle, read, shape, side } from "../../spec/style.ts";
import { parts } from "./parts.ts";
import { lines, marks, neighbours, type Wire } from "./read.ts";
import { STYLE } from "./sheet.ts";

export { shown } from "./read.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** What `find.index` answers (the find pack's own key). */
interface Row {
  id: Id;
  type: string;
  fields: Record<string, Json>;
}
interface FindIndex {
  item(id: Id): Row | undefined;
  linksOf(id: Id): Wire[];
  types(): TypeInfo[];
  type(name: string): TypeInfo | undefined;
  watch(on: () => void): () => void;
}

const QUERY = "find.query";

const item: Pack = {
  id: "item",
  about: "The page for one item: its note, its fields, what it is tied to, and its history with undo.",
  inject: ["find.index", "here.read", "here.set", "slot.fill", "action.invoke"],
  apply(ctx: Context) {
    const index = ctx.get<FindIndex>("find.index");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    const invoke = ctx.get<ActionInvoke>("action.invoke");

    const useHere = <T extends Json>(key: string): T | undefined => {
      const [v, setV] = useState<T | undefined>(here.get<T>(key));
      useEffect(() => here.watch(key, (c) => setV(c.value as T | undefined)) as () => void, [key]);
      return v;
    };
    const useIndex = () => {
      const [, tick] = useState(0);
      useEffect(() => index.watch(() => tick((x) => x + 1)) as () => void, []);
      return index;
    };
    const markOf = (r: Row | undefined) => {
      const t = r && index.type(r.type);
      const bases = index.types().filter((x) => x.base === x.name).map((x) => x.name);
      const at = side(t, r?.fields.status);
      return { glyph: read(glyph(shape(bases, t), at)), side: at };
    };
    const open = (id: Id) => set.set(KEYS.item, id);
    const P = parts({
      name: (id) => {
        const r = index.item(id);
        return r ? String(r.fields.title ?? id) : undefined;
      },
      mark: (id) => markOf(index.item(id)),
      open,
      invoke,
    });

    const Page = () => {
      const idx = useIndex();
      const id = useHere<string>(KEYS.item);
      const [, restyle] = useState(0);
      useEffect(() => onStyle(() => restyle((n) => n + 1)), []);
      if (!id) return null;
      const row = idx.item(id);
      const close = html`<button class="ip-x" title="Close" onClick=${() => set.set(KEYS.item, undefined)}>×</button>`;
      if (!row) return html`<div class="ip"><div class="ip-head"><span class="t ip-dim">${id} isn't on the map now.</span>${close}</div></div>`;
      const t = idx.type(row.type);
      const wires = idx.linksOf(id);
      const groups = neighbours(id, wires);
      // The history is read again whenever the item or its links change.
      const seen = JSON.stringify([row.fields, wires.map((w) => w.id)]);
      const note = typeof row.fields.note === "string" ? row.fields.note.trim() : "";
      return html`
        <div class="ip">
          <div class="ip-head">
            <${P.Mk} id=${id} />
            <span class="t" title=${String(row.fields.title ?? "")}>${String(row.fields.title ?? id)}</span>
            ${close}
          </div>
          <div class="ip-sub">${row.type}${t && t.base !== t.name ? ` (${t.base})` : ""} · ${String(row.fields.status ?? "")}</div>
          <${P.Marks} marks=${marks(row.fields, t?.fields ?? {})} />
          ${note && html`<${P.Note} key=${id} text=${note} />`}
          ${groups.length > 0 && html`<div class="ip-label">Tied to</div>`}
          <${P.Neighbours} key=${id} groups=${groups} />
          <div class="ip-label">History</div>
          <${P.History} key=${id} id=${id} tick=${seen} lines=${lines} />
          <div class="ip-foot">
            <button class="ip-btn" onClick=${() => set.set(QUERY, `in:${id}`)} title="Draw this and its parts">inside</button>
            <button class="ip-btn" onClick=${() => set.set(QUERY, `near:${id}`)} title="Draw this and what it is linked to">around</button>
            <span class="ip-dim" style="margin-left:auto; font-size:var(--text-xs)">${id}</span>
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
    // Beside the views that open an item: Map, and Landscape.
    const fill = ctx.get<SlotFill>("slot.fill");
    fill.fill({ slot: "right", name: "page", title: "Item", when: { "here.item": true, "here.view": "map/map" }, view: Page });
    fill.fill({ slot: "right", name: "page-field", title: "Item", when: { "here.item": true, "here.view": "field/field" }, view: Page });
  },
};

export default item;
