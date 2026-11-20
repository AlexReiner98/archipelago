/**
 * The item pack, page side: one page per item, in `map.side`, for the item
 * `here.item` names. Its title, status, fields and note, and its links,
 * one line each. Every edit is an action (`items.set`, `items.link`,
 * `items.unlink`, `items.create`); the page shows what the graph then
 * holds, through `find.index`.
 *
 * Fields are drawn by kind, statuses by their base's sides, never by a
 * type's name. Only the fields an item has are shown; "+ field" adds one.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import type { Id, Json } from "../../spec/common.ts";
import type { HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { FieldDef, LinkInfo, TypeInfo } from "../../spec/types.ts";
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
  links(): LinkInfo[];
  type(name: string): TypeInfo | undefined;
  run(query: string, limit?: number): { items: Row[] };
  watch(on: () => void): () => void;
}

const QUERY = "find.query";
const AUTH = { of: "human" as const, basis: "an edit on the item page" };
const SHOWN = new Set(["title", "note", "status"]);

const STYLE = `
.ip { padding:6px 0 12px; }
.ip-head { display:flex; gap:6px; align-items:center; padding:2px 10px 4px; }
.ip-head input { flex:1; min-width:0; font:600 14px ui-sans-serif, system-ui, sans-serif; background:none; color:var(--fg); border:1px solid transparent; border-radius:3px; padding:2px 4px; }
.ip-head input:hover, .ip-head input:focus { border-color:var(--line); background:var(--panel); }
.ip-x { font:inherit; background:none; border:0; color:var(--dim); cursor:pointer; padding:0 4px; }
.ip-x:hover { color:var(--fg); }
.ip-mk { width:1.1em; text-align:center; flex:none; color:var(--dim); }
.ip-mk.s-moving { color:var(--pick); } .ip-mk.s-done { color:var(--held); }
.ip-row { display:flex; gap:8px; align-items:center; padding:1px 10px; white-space:nowrap; min-height:22px; }
.ip-row .k { color:var(--dim); width:7.5em; flex:none; overflow:hidden; text-overflow:ellipsis; }
.ip-row .v { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.ip-row input:not([type=checkbox]), .ip-row select { font:inherit; background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:3px; padding:0 4px; min-width:0; }
.ip-row input:not([type=checkbox]) { flex:1; }
.ip-group { padding:8px 10px 2px; color:var(--dim); font-size:11px; }
.ip-note { margin:2px 10px; }
.ip-note textarea { width:100%; box-sizing:border-box; min-height:3.2em; font:inherit; background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:3px; padding:3px 6px; resize:vertical; }
.ip-link { cursor:pointer; }
.ip-link:hover { background:color-mix(in srgb, var(--line) 50%, transparent); }
.ip-link .k { width:8.5em; }
.ip-say { margin:4px 10px; padding:3px 6px; border-left:3px solid var(--failed); color:var(--dim); white-space:normal; }
.ip-dim { color:var(--dim); }
.ip-btn { font:inherit; background:none; border:1px solid var(--line); color:var(--dim); border-radius:3px; padding:0 6px; cursor:pointer; }
.ip-btn:hover { color:var(--fg); border-color:var(--dim); }
`;

/** Marks, by base and status side (the same rule the canvas draws by). */
const SHAPES = [["□", "◧", "■", "⊠"], ["◇", "◈", "◆", "⟡"], ["○", "◐", "●", "⊘"], ["△", "◭", "▲", "⊿"]];
const sideOf = (t: TypeInfo | undefined, s: Json | undefined) => {
  if (!t || typeof s !== "string") return 0;
  const o = t.statuses.open.indexOf(s);
  if (o >= 0) return o === 0 ? 0 : 1;
  return t.statuses.closed.indexOf(s) <= 0 ? 2 : 3;
};
const SIDES = ["fresh", "moving", "done", "gone"];

const item: Pack = {
  id: "item",
  inject: ["find.index", "here.read", "here.set", "action.invoke", "slot.fill"],
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
      const s = sideOf(t, r?.fields.status);
      return { glyph: SHAPES[Math.max(0, bases.indexOf(t?.base ?? "")) % SHAPES.length]![s]!, side: SIDES[s]! };
    };

    /** One field's editor, by its kind. Commits on change, Enter or leaving it. */
    const Field = ({ def, value, save }: { def: FieldDef; value: Json | undefined; save: (v: Json) => void }) => {
      const [draft, setDraft] = useState(value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value));
      useEffect(() => setDraft(value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value)), [JSON.stringify(value)]);
      if (def.kind === "boolean") return html`<input type="checkbox" checked=${value === true} onChange=${(e: Event) => save((e.target as HTMLInputElement).checked)} />`;
      if (def.kind === "choice")
        return html`<select value=${String(value ?? "")} onChange=${(e: Event) => save((e.target as HTMLSelectElement).value || null)}>
          <option value=""></option>
          ${(def.values ?? []).map((v) => html`<option value=${v}>${v}</option>`)}
        </select>`;
      const commit = () => {
        const s = draft.trim();
        if (s === (value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value))) return;
        if (!s) return save(null);
        if (def.kind === "number") return save(Number(s));
        if (def.kind === "json") {
          try {
            return save(JSON.parse(s));
          } catch {
            return save(s);
          }
        }
        save(s);
      };
      return html`<input
        type=${def.kind === "date" ? "date" : def.kind === "number" ? "number" : "text"}
        value=${def.kind === "date" ? draft.slice(0, 10) : draft}
        onInput=${(e: Event) => setDraft((e.target as HTMLInputElement).value)}
        onBlur=${commit}
        onKeyDown=${(e: KeyboardEvent) => e.key === "Enter" && commit()}
      />`;
    };

    const Page = () => {
      const idx = useIndex();
      const id = useHere<string>(KEYS.item);
      const [said, say] = useState("");
      const [title, setTitle] = useState("");
      const [note, setNote] = useState("");
      const [adding, setAdding] = useState("");
      const [kind, setKind] = useState("depends_on");
      const [target, setTarget] = useState("");
      const [part, setPart] = useState("");
      const row = id ? idx.item(id) : undefined;
      useEffect(() => {
        setTitle(String(row?.fields.title ?? ""));
        setNote(String(row?.fields.note ?? ""));
      }, [id, row?.fields.title, row?.fields.note]);
      useEffect(() => say(""), [id]);
      if (!id) return null;
      if (!row) return html`<div class="ip"><div class="ip-head"><span class="ip-dim">${id} isn't on the map now.</span><button class="ip-x" onClick=${() => set.set(KEYS.item, undefined)}>×</button></div></div>`;
      const t = idx.type(row.type);

      const act = async (action: string, input: Json, reason: string) => {
        const out = await invoke.invoke({ action, input, authority: AUTH, reason });
        say(out.ok ? "" : out.refused.message);
        return out;
      };
      const setField = (k: string, v: Json) => act("items.set", { id, fields: { [k]: v } }, `Set ${k} on the item page`);
      const m = markOf(row);
      const own = Object.entries(t?.fields ?? {}).filter(([k]) => !SHOWN.has(k));
      const has = own.filter(([k]) => row.fields[k] !== undefined || k === adding);
      const missing = own.filter(([k]) => row.fields[k] === undefined && k !== adding);
      const wires = idx.linksOf(id);
      const out = wires.filter((l) => l.from === id);
      const inn = wires.filter((l) => l.to === id);
      const choices = target.trim().length > 1 ? idx.run(target, 12).items.filter((r) => r.id !== id) : [];
      const link = async () => {
        const hit = choices.find((r) => String(r.fields.title).toLowerCase() === target.trim().toLowerCase()) ?? idx.item(target.trim()) ?? choices[0];
        if (!hit) return say(`Nothing on the map is called ${target}.`);
        const done = await act("items.link", { type: kind, from: id, to: hit.id }, `Linked ${kind} on the item page`);
        if (done.ok) setTarget("");
      };
      const makePart = async () => {
        if (!part.trim()) return;
        const done = await act("items.create", { type: row.type, title: part.trim(), part_of: id }, "Made a part on the item page");
        if (done.ok) setPart("");
      };
      const LinkRow = ({ l, dir }: { l: Wire; dir: "out" | "in" }) => {
        const other = idx.item(dir === "out" ? l.to : l.from);
        const om = markOf(other);
        return html`
          <div class="ip-row ip-link" onClick=${() => other && set.set(KEYS.item, other.id)} title=${other ? `${other.type} · ${String(other.fields.status ?? "")}` : ""}>
            <span class="k">${dir === "out" ? "→" : "←"} ${l.type}</span>
            <span class=${`ip-mk s-${om.side}`}>${om.glyph}</span>
            <span class="v">${String(other?.fields.title ?? (dir === "out" ? l.to : l.from))}${l.fields.for ? html` <span class="ip-dim">· ${String(l.fields.for)}</span>` : ""}</span>
            <button class="ip-x" title="Take this link away" onClick=${(e: Event) => (e.stopPropagation(), act("items.unlink", { id: l.id }, "Unlinked on the item page"))}>×</button>
          </div>
        `;
      };
      const saveTitle = () => title.trim() && title !== row.fields.title && setField("title", title.trim());

      return html`
        <div class="ip">
          <div class="ip-head">
            <span class=${`ip-mk s-${m.side}`}>${m.glyph}</span>
            <input value=${title} onInput=${(e: Event) => setTitle((e.target as HTMLInputElement).value)} onBlur=${saveTitle} onKeyDown=${(e: KeyboardEvent) => e.key === "Enter" && saveTitle()} />
            <button class="ip-x" title="Close" onClick=${() => set.set(KEYS.item, undefined)}>×</button>
          </div>
          ${said && html`<div class="ip-say">${said}</div>`}
          <div class="ip-row">
            <span class="k">${row.type}${t && t.base !== t.name ? html` <span class="ip-dim">(${t.base})</span>` : ""}</span>
            <select class="v" value=${String(row.fields.status ?? "")} onChange=${(e: Event) => setField("status", (e.target as HTMLSelectElement).value)}>
              ${(t?.statuses.open ?? []).map((s) => html`<option value=${s}>${s}</option>`)}
              <option disabled>──</option>
              ${(t?.statuses.closed ?? []).map((s) => html`<option value=${s}>${s}</option>`)}
            </select>
          </div>
          ${has.map(
            ([k, def]) => html`<div class="ip-row" key=${k}><span class="k" title=${def.doc ?? ""}>${k}</span><span class="v" style="display:flex"><${Field} def=${def} value=${row.fields[k]} save=${(v: Json) => (setAdding(""), setField(k, v))} /></span></div>`,
          )}
          ${missing.length > 0 &&
          html`<div class="ip-row"><span class="k"></span>
            <select value="" onChange=${(e: Event) => setAdding((e.target as HTMLSelectElement).value)}>
              <option value="">+ field</option>
              ${missing.map(([k]) => html`<option value=${k}>${k}</option>`)}
            </select></div>`}
          <div class="ip-note">
            <textarea placeholder="note" value=${note} onInput=${(e: Event) => setNote((e.target as HTMLTextAreaElement).value)} onBlur=${() => note !== String(row.fields.note ?? "") && setField("note", note.trim() ? note : null)}></textarea>
          </div>
          <div class="ip-group">Links</div>
          ${out.map((l) => html`<${LinkRow} key=${l.id} l=${l} dir="out" />`)}
          ${inn.map((l) => html`<${LinkRow} key=${l.id} l=${l} dir="in" />`)}
          <div class="ip-row">
            <select value=${kind} onChange=${(e: Event) => setKind((e.target as HTMLSelectElement).value)}>
              ${idx.links().map((l) => html`<option value=${l.name}>→ ${l.name}</option>`)}
            </select>
            <input list="ip-targets" placeholder="an item's title" value=${target} onInput=${(e: Event) => setTarget((e.target as HTMLInputElement).value)} onKeyDown=${(e: KeyboardEvent) => e.key === "Enter" && link()} />
            <datalist id="ip-targets">${choices.map((r) => html`<option value=${String(r.fields.title)} />`)}</datalist>
          </div>
          <div class="ip-row">
            <span class="k">+ part</span>
            <input placeholder="a part's title" value=${part} onInput=${(e: Event) => setPart((e.target as HTMLInputElement).value)} onKeyDown=${(e: KeyboardEvent) => e.key === "Enter" && makePart()} />
          </div>
          <div class="ip-row" style="margin-top:6px">
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
