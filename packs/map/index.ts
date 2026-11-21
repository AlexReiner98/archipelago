/**
 * The map pack, page side: the canvas of a query, in the shell as the view
 * "Map". One flat plane: the query is the whole surface (`find.query`,
 * drawn through `find.index`), each item one line with the mark of its
 * state, links as right-angled wires (layout.ts).
 *
 * - A click on an item sets `here.item`; its wires and neighbours light.
 *   Hovering an item lights its wires and neighbours too, over the rest.
 * - The legend holds every mark: each base with each of its statuses (read
 *   from the types), and each kind of link.
 * - The plane pans by dragging, zooms by the wheel, and fits again on a
 *   double-click.
 * - It only shows: nobody adds or links items by hand here. Agents change
 *   the map through the items actions, and the canvas follows live.
 * - Declares `map.bar` (many: the find line goes there) and `map.side`
 *   (one: the item page goes there), so other packs fill them.
 *
 * Drawn as SVG components: the canvas holds a query's items, at most a few
 * hundred. The scene surface (spec/scene.md) is for the graph at scale.
 */
import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { Id, Json } from "../../spec/common.ts";
import type { HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotDeclare, SlotFill, SlotRead } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import type { LinkInfo, TypeInfo } from "../../spec/types.ts";
import { layout, SIZE, type Out } from "./layout.ts";
import { mark, side } from "./marks.ts";
import { onStyle, sheet } from "../../spec/style.ts";

export { mark, side } from "./marks.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** What `find.index` answers (the find pack's own key). */
interface Row {
  id: Id;
  type: string;
  fields: Record<string, Json>;
}
interface Result {
  items: Row[];
  links: (Row & { from: Id; to: Id })[];
  more: number;
}
interface FindIndex {
  ready(): boolean;
  item(id: Id): Row | undefined;
  types(): TypeInfo[];
  links(): LinkInfo[];
  type(name: string): TypeInfo | undefined;
  run(query: string, limit?: number): Result;
  watch(on: () => void): () => void;
}

const QUERY = "find.query";

const STYLE = sheet(`
.mp { display:grid; grid-template-rows:auto 1fr; height:100%; min-height:0; }
.mp-bar { display:flex; gap:var(--space-3); align-items:center; padding:var(--space-2) var(--space-4); border-bottom:1px solid var(--line); white-space:nowrap; min-width:0; }
.mp-bar select, .mp-bar button { font:inherit; background:var(--control); color:var(--control-fg); border:1px solid var(--control-line); border-radius:var(--radius); padding:0 var(--space-3); cursor:pointer; }
.mp-bar .dim { color:var(--dim); }
.mp-body { display:flex; min-height:0; }
.mp-canvas { flex:1; min-width:0; position:relative; overflow:hidden; cursor:grab; user-select:none; }
.mp-canvas.panning { cursor:grabbing; }
.mp-canvas svg { width:100%; height:100%; display:block; }
.mp-side { width:min(380px, 40%); flex:none; border-left:1px solid var(--line); overflow:auto; }
.mp-card rect { fill:var(--panel); stroke:var(--line); }
.mp-card { cursor:pointer; }
.mp-card text { font:var(--text-m) var(--font); fill:var(--fg); dominant-baseline:central; }
.mp-card .mk { font-size:var(--text); }
.mp-card.s-fresh .mk { fill:var(--mark-fresh); } .mp-card.s-moving .mk { fill:var(--mark-moving); }
.mp-card.s-done .mk { fill:var(--mark-done); } .mp-card.s-gone .mk { fill:var(--mark-gone); }
.mp-card.s-done text.t, .mp-card.s-gone text.t { fill:var(--dim); }
.mp-card.s-gone text.t { text-decoration:line-through; }
.mp-card.pick rect { stroke:var(--pick); stroke-width:2; }
.mp-card.near rect { fill:var(--lit); }
.mp-wire { fill:none; stroke:var(--dim); stroke-width:1.2; }
.mp-wire.part_of { stroke-dasharray:5 3; }
.mp-wire.bears_on { stroke-dasharray:1 3; stroke-linecap:round; stroke-width:1.6; }
.mp-wire.waits_on { stroke-dasharray:7 3 1.5 3; }
.mp-wire.about { stroke:var(--line); }
.mp-wire.lit { stroke:var(--pick); stroke-width:2.2; }
.mp-key { position:absolute; left:8px; bottom:6px; color:var(--dim); font-size:var(--text-s); background:color-mix(in srgb, var(--bg) 88%, transparent); padding:var(--space-2) var(--space-3); border-radius:var(--radius); border:1px solid var(--line); display:grid; grid-template-columns:auto 1fr; column-gap:10px; row-gap:1px; pointer-events:none; }
.mp-key .b { color:var(--fg); }
.mp-key .row { display:flex; gap:10px; white-space:nowrap; align-items:center; }
.mp-key .row > span { display:inline-flex; align-items:center; gap:3px; }
.mp-key .m { display:inline-block; width:1.1em; text-align:center; }
.mp-key .m.s-fresh { color:var(--mark-fresh); } .mp-key .m.s-moving { color:var(--mark-moving); } .mp-key .m.s-done { color:var(--mark-done); } .mp-key .m.s-gone { color:var(--mark-gone); }
.mp-key svg { width:22px; height:8px; vertical-align:middle; }
.mp-key .sw { display:inline-block; width:16px; height:9px; border-radius:2px; border:1px solid var(--line); background:var(--panel); }
.mp-key .sw.pick { border:2px solid var(--pick); width:14px; height:7px; }
.mp-key .sw.near { background:var(--lit); }
.mp-card.hover rect { stroke:var(--pick); }
.mp-wire.hot { stroke:var(--pick); stroke-width:2.2; }
.mp-empty { position:absolute; inset:0; display:grid; place-items:center; color:var(--dim); }
`);

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const map: Pack = {
  id: "map",
  inject: ["find.index", "here.read", "here.set", "slot.declare", "slot.fill", "slot.read"],
  apply(ctx: Context) {
    const index = ctx.get<FindIndex>("find.index");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    const slots = ctx.get<SlotRead>("slot.read");
    const declare = ctx.get<SlotDeclare>("slot.declare");
    declare.declare({ name: "map.bar", merge: "many", doc: "The map's top line: find goes here." });
    declare.declare({ name: "map.side", merge: "one", doc: "Beside the canvas: the item page goes here." });

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
    const Slot = ({ name }: { name: string }) => {
      const [, tick] = useState(0);
      useEffect(() => {
        const stop = slots.watch(name, () => tick((x) => x + 1));
        tick((x) => x + 1);
        return stop as () => void;
      }, [name]);
      return html`${slots.fills(name).map((f) => html`<${f.view} key=${`${f.pack}/${f.name}`} />`)}`;
    };

    /** Every mark the canvas draws: each base with each of its statuses, then each kind of link. */
    const Key = () => {
      const all = index.types();
      const bases = all.filter((t) => t.base === t.name);
      const names = bases.map((t) => t.name);
      const known = new Set(["depends_on", "part_of", "waits_on", "bears_on", "about"]);
      const kinds = index.links().map((l) => l.name);
      return html`
        <div class="mp-key">
          ${bases.map(
            (t) => html`
              <span class="b">${t.name}</span>
              <span class="row">
                ${[...t.statuses.open, ...t.statuses.closed].map(
                  (st) => html`<span><span class=${`m s-${side(t, st)}`}>${mark(names, t, st)}</span>${st}</span>`,
                )}
              </span>
            `,
          )}
          <span class="b">lit</span>
          <span class="row">
            <span><span class="sw pick"></span> hovered or open</span>
            <span><span class="sw near"></span> linked to it</span>
            <span><svg viewBox="0 0 22 8"><path class="mp-wire lit" d="M0 4H22" /></svg> its links</span>
          </span>
          <span class="b">links</span>
          <span class="row">
            ${kinds.map((k) => html`<span><svg viewBox="0 0 22 8"><path class=${`mp-wire ${known.has(k) ? k : ""}`} d="M0 4H22" /></svg> ${k}</span>`)}
          </span>
        </div>
      `;
    };

    const Canvas = ({ result, drawn }: { result: Result; drawn: Out }) => {
      const picked = useHere<string>(KEYS.item);
      const box = useRef<HTMLDivElement>(null);
      const [view, setView] = useState({ x: -20, y: -20, k: 1 });
      const [panning, setPanning] = useState(false);
      const [fits, refit] = useState(0);
      const [hover, setHover] = useState<Id | undefined>();
      const bases = useMemo(() => index.types().filter((t) => t.base === t.name).map((t) => t.name), [result]);

      // Fit the drawing when what is drawn changes shape, not when the pane beside it opens.
      const shape = `${drawn.width}x${drawn.height}:${result.items.length}`;
      useEffect(() => {
        const W = box.current?.clientWidth || 800;
        const H = box.current?.clientHeight || 600;
        const k = Math.min(1.1, Math.max(0.6, Math.min((W - 40) / Math.max(drawn.width, 1), (H - 60) / Math.max(drawn.height, 1))));
        setView({ x: -20 / k, y: -20 / k, k });
      }, [shape, fits]);

      const toWorld = (e: { clientX: number; clientY: number }) => {
        const r = box.current!.getBoundingClientRect();
        return { x: view.x + (e.clientX - r.left) / view.k, y: view.y + (e.clientY - r.top) / view.k };
      };
      const at = (p: { x: number; y: number }) => {
        for (const b of drawn.boxes.values()) if (p.x >= b.x && p.x <= b.x + SIZE.w && p.y >= b.y && p.y <= b.y + SIZE.h) return b.id;
        return undefined;
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const p = toWorld(e);
        const k = Math.min(3, Math.max(0.15, view.k * Math.exp(-e.deltaY * 0.0015)));
        const r = box.current!.getBoundingClientRect();
        setView({ k, x: p.x - (e.clientX - r.left) / k, y: p.y - (e.clientY - r.top) / k });
      };
      const onDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        const p = toWorld(e);
        const hit = at(p);
        const start = { cx: e.clientX, cy: e.clientY, view };
        let moved = false;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const move = (m: PointerEvent) => {
          if (!moved && Math.hypot(m.clientX - start.cx, m.clientY - start.cy) < 4) return;
          moved = true;
          setPanning(true);
          setView({ ...start.view, x: start.view.x - (m.clientX - start.cx) / start.view.k, y: start.view.y - (m.clientY - start.cy) / start.view.k });
        };
        const up = () => {
          box.current?.removeEventListener("pointermove", move);
          box.current?.removeEventListener("pointerup", up);
          box.current?.removeEventListener("pointercancel", up);
          setPanning(false);
          if (!moved) set.set(KEYS.item, hit);
        };
        box.current!.addEventListener("pointermove", move);
        box.current!.addEventListener("pointerup", up);
        box.current!.addEventListener("pointercancel", up);
      };

      const neighbours = (id: Id | undefined) => {
        const s = new Set<Id>();
        if (id) for (const l of result.links) if (l.from === id) s.add(l.to);
        else if (l.to === id) s.add(l.from);
        return s;
      };
      const near = useMemo(() => neighbours(picked), [picked, result]);
      const hoverNear = useMemo(() => neighbours(hover), [hover, result]);
      const touches = (p: { from: Id; to: Id }, id: Id | undefined) => !!id && (p.from === id || p.to === id);
      // Lit wires are drawn last, so they lie over the others.
      const wires = [...drawn.paths].sort((a, b) => Number(touches(a, hover) || touches(a, picked)) - Number(touches(b, hover) || touches(b, picked)));
      const titleLen = Math.floor((SIZE.w - 30) / 6.4);
      return html`
        <div class=${`mp-canvas${panning ? " panning" : ""}`} ref=${box} onWheel=${onWheel} onPointerDown=${onDown} onDblClick=${(e: MouseEvent) => !at(toWorld(e)) && refit((n) => n + 1)} title="Click an item to open it; drag to move the plane; double-click to fit">
          <svg><g transform=${`scale(${view.k}) translate(${-view.x} ${-view.y})`}>
            ${wires.map(
              (p) => html`<path key=${p.id} class=${`mp-wire ${p.type}${touches(p, hover) ? " hot" : touches(p, picked) ? " lit" : ""}`} d=${`M${p.points.map((q) => q.join(" ")).join("L")}`}><title>${p.type}</title></path>`,
            )}
            ${result.items.map((r) => {
              const b = drawn.boxes.get(r.id)!;
              const t = index.type(r.type);
              const title = String(r.fields.title ?? r.id);
              const cls = `mp-card s-${side(t, r.fields.status)}${r.id === picked ? " pick" : ""}${near.has(r.id) || hoverNear.has(r.id) ? " near" : ""}${r.id === hover ? " hover" : ""}`;
              return html`
                <g key=${r.id} class=${cls} transform=${`translate(${b.x} ${b.y})`} onPointerEnter=${() => setHover(r.id)} onPointerLeave=${() => setHover((h) => (h === r.id ? undefined : h))}>
                  <title>${title} · ${r.type} · ${String(r.fields.status ?? "")}</title>
                  <rect width=${SIZE.w} height=${SIZE.h} rx="3" />
                  <text class="mk" x="9" y=${SIZE.h / 2}>${mark(bases, t, r.fields.status)}</text>
                  <text class="t" x="24" y=${SIZE.h / 2}>${clip(title, titleLen)}</text>
                </g>
              `;
            })}
          </g></svg>
          ${!result.items.length && html`<div class="mp-empty">${index.ready() ? "Nothing matches." : "Reading the map…"}</div>`}
          <${Key} />
        </div>
      `;
    };

    const View = () => {
      const idx = useIndex();
      const q = useHere<string>(QUERY) ?? "";
      const picked = useHere<string>(KEYS.item);
      const result = idx.run(q);
      const [, restyle] = useState(0);
      useEffect(() => onStyle(() => restyle((n) => n + 1)), []);
      const drawn = useMemo(() => layout(result), [JSON.stringify([result.items.map((r) => r.id), result.links.map((l) => [l.id, l.from, l.to])])]);
      useEffect(() => {
        const esc = (e: KeyboardEvent) => e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) && set.set(KEYS.item, undefined);
        addEventListener("keydown", esc);
        return () => removeEventListener("keydown", esc);
      }, []);
      return html`
        <div class="mp">
          <div class="mp-bar">
            <${Slot} name="map.bar" />
          </div>
          <div class="mp-body">
            <${Canvas} result=${result} drawn=${drawn} />
            ${picked && html`<div class="mp-side"><${Slot} name="map.side" /></div>`}
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
    ctx.get<SlotFill>("slot.fill").fill({ slot: "shell.main", name: "map", title: "Map", view: View });
  },
};

export default map;
