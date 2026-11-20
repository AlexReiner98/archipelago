/**
 * The item pack, page side: one page per item, in `map.side`, for the item
 * `here.item` names. Its title and status, the fields it has, its note, and
 * its links, one line each; a link opens the item at its other end.
 *
 * It only shows. Nobody adds, links or edits items by hand here: agents
 * change the map through the items actions, and the page follows live
 * through `find.index`. Statuses are drawn by their base's sides and fields
 * by kind, never by a type's name.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { Id, Json } from "../../spec/common.ts";
import type { HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { FieldDef, TypeInfo } from "../../spec/types.ts";
import type { Context, Pack } from "../../runtime/core.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** What `find.index` answers (the find pack's own key). */
interface Row {
  id: Id;
  type: string;
  fields: Record<string, Json>;
}
type Wire = Row & { from: Id; to: Id };
interface FindIndex {
  item(id: Id): Row | undefined;
  linksOf(id: Id): Wire[];
  types(): TypeInfo[];
  type(name: string): TypeInfo | undefined;
  watch(on: () => void): () => void;
}

const QUERY = "find.query";
const SHOWN = new Set(["title", "note", "status"]);

const STYLE = `
.ip { padding:6px 0 12px; }
.ip-head { display:flex; gap:6px; align-items:center; padding:4px 10px 6px; }
.ip-head .t { flex:1; min-width:0; font:600 14px ui-sans-serif, system-ui, sans-serif; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ip-x { font:inherit; background:none; border:0; color:var(--dim); cursor:pointer; padding:0 4px; }
.ip-x:hover { color:var(--fg); }
.ip-mk { width:1.1em; text-align:center; flex:none; color:var(--dim); }
.ip-mk.s-moving { color:var(--pick); } .ip-mk.s-done { color:var(--held); } .ip-mk.s-gone { color:var(--quiet); }
.ip-row { display:flex; gap:8px; align-items:baseline; padding:1px 10px; white-space:nowrap; min-height:20px; }
.ip-row .k { color:var(--dim); width:8.5em; flex:none; overflow:hidden; text-overflow:ellipsis; }
.ip-row .v { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.ip-group { padding:8px 10px 2px; color:var(--dim); font-size:11px; }
.ip-note { margin:4px 10px; padding:3px 6px; border-left:2px solid var(--line); white-space:pre-wrap; }
.ip-link { cursor:pointer; }
.ip-link:hover { background:color-mix(in srgb, var(--line) 50%, transparent); }
.ip-dim { color:var(--dim); }
.ip-btn { font:inherit; background:none; border:1px solid var(--line); color:var(--dim); border-radius:3px; padding:0 6px; cursor:pointer; }
.ip-btn:hover { color:var(--fg); border-color:var(--dim); }
`;

/** Marks, by base and status side (the same rule the canvas draws by). */
const SHAPES = [["□", "◧", "■", "■"], ["◇", "◈", "◆", "◆"], ["○", "◐", "●", "●"], ["△", "◭", "▲", "▲"]];
const sideOf = (t: TypeInfo | undefined, s: Json | undefined) => {
  if (!t || typeof s !== "string") return 0;
  const o = t.statuses.open.indexOf(s);
  if (o >= 0) return o === 0 ? 0 : 1;
  return t.statuses.closed.indexOf(s) <= 0 ? 2 : 3;
};
const SIDES = ["fresh", "moving", "done", "gone"];

/** A value as one line, by its field's kind. */
export function shown(def: FieldDef | undefined, v: Json): string {
  if (v === null || v === undefined) return "";
  if (def?.kind === "boolean") return v ? "yes" : "no";
  if (def?.kind === "date" && typeof v === "string") return v.slice(0, 10);
  if (def?.kind === "number" && typeof v === "number") return v.toLocaleString("en");
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" · ");
  return typeof v === "string" ? v : JSON.stringify(v);
}

const item: Pack = {
  id: "item",
  inject: ["find.index", "here.read", "here.set", "slot.fill"],
  apply(ctx: Context) {
    const index = ctx.get<FindIndex>("find.index");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");

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
      const s = sideOf(t, r?.fields.status);
      return { glyph: SHAPES[Math.max(0, bases.indexOf(t?.base ?? "")) % SHAPES.length]![s]!, side: SIDES[s]! };
    };

    const Page = () => {
      const idx = useIndex();
      const id = useHere<string>(KEYS.item);
      if (!id) return null;
      const row = idx.item(id);
      const close = html`<button class="ip-x" title="Close" onClick=${() => set.set(KEYS.item, undefined)}>×</button>`;
      if (!row) return html`<div class="ip"><div class="ip-head"><span class="t ip-dim">${id} isn't on the map now.</span>${close}</div></div>`;
      const t = idx.type(row.type);
      const m = markOf(row);
      const fields = Object.entries(t?.fields ?? {}).filter(([k]) => !SHOWN.has(k) && row.fields[k] !== undefined && row.fields[k] !== null);
      const wires = idx.linksOf(id);
      const LinkRow = ({ l, dir }: { l: Wire; dir: "out" | "in" }) => {
        const other = idx.item(dir === "out" ? l.to : l.from);
        const om = markOf(other);
        return html`
          <div class="ip-row ip-link" onClick=${() => other && set.set(KEYS.item, other.id)} title=${other ? `${other.type} · ${String(other.fields.status ?? "")}` : ""}>
            <span class="k">${dir === "out" ? "→" : "←"} ${l.type}</span>
            <span class=${`ip-mk s-${om.side}`}>${om.glyph}</span>
            <span class="v">${String(other?.fields.title ?? (dir === "out" ? l.to : l.from))}${l.fields.for ? html` <span class="ip-dim">· ${String(l.fields.for)}</span>` : ""}</span>
          </div>
        `;
      };
      return html`
        <div class="ip">
          <div class="ip-head">
            <span class=${`ip-mk s-${m.side}`}>${m.glyph}</span>
            <span class="t" title=${String(row.fields.title ?? "")}>${String(row.fields.title ?? id)}</span>
            ${close}
          </div>
          <div class="ip-row">
            <span class="k">${row.type}${t && t.base !== t.name ? html` <span class="ip-dim">(${t.base})</span>` : ""}</span>
            <span class="v">${String(row.fields.status ?? "")}</span>
          </div>
          ${fields.map(([k, def]) => html`<div class="ip-row" key=${k}><span class="k" title=${def.doc ?? ""}>${k}</span><span class="v" title=${shown(def, row.fields[k]!)}>${shown(def, row.fields[k]!)}</span></div>`)}
          ${typeof row.fields.note === "string" && row.fields.note.trim() && html`<div class="ip-note">${row.fields.note}</div>`}
          ${wires.length > 0 && html`<div class="ip-group">Links</div>`}
          ${wires.filter((l) => l.from === id).map((l) => html`<${LinkRow} key=${l.id} l=${l} dir="out" />`)}
          ${wires.filter((l) => l.to === id).map((l) => html`<${LinkRow} key=${l.id} l=${l} dir="in" />`)}
          <div class="ip-row" style="margin-top:8px">
            <button class="ip-btn" onClick=${() => set.set(QUERY, `in:${id}`)} title="Draw this and its parts">inside</button>
            <button class="ip-btn" onClick=${() => set.set(QUERY, `near:${id}`)} title="Draw this and what it is linked to">around</button>
            <span class="ip-dim" style="margin-left:auto">${id}</span>
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
    ctx.get<SlotFill>("slot.fill").fill({ slot: "map.side", name: "page", title: "Item", view: Page });
  },
};

export default item;
