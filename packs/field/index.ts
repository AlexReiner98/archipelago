/**
 * The field pack, page side: the map as particles, in the shell as the
 * view "Field", beside "Map". It lays out the whole map, open and closed
 * (up to `field_limit` items), whatever the query: the find line
 * (`find.query`) only lights what it finds and fades the rest, so a query
 * never moves a particle. Each item a particle in its type's colour,
 * links as faint lines; clusters come from the links alone. Composable behaviours settle
 * it (step.ts, behaviours/); each behaviour, and every number it reads, is
 * a dial in the panel on the left.
 *
 * - Hovering a particle lights it and its links; a click sets `here.item`
 *   and the item page opens beside (`map.side`, as on Map).
 * - The dials' values are `field.dials` (page scope), so an agent can turn
 *   them too; this browser also remembers them.
 * - It only shows: nothing here writes to the map.
 */
import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { Id, Json } from "../../spec/common.ts";
import type { HereDeclare, HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill, SlotRead } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import type { LinkInfo } from "../../spec/types.ts";
import type { Dial } from "./behaviour.ts";
import { field, type Field } from "./engine.ts";
import { typeColours, type FieldIn, type Settings } from "./graph.ts";
import { DRAW } from "./paint.ts";
import { Panel, PANEL_STYLE, type Section } from "./panel.ts";
import { BEHAVIOURS, RUN, defaults } from "./step.ts";

export { BEHAVIOURS, step } from "./step.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

interface Row {
  id: Id;
  type: string;
  fields: Record<string, Json>;
}
interface FindIndex {
  linksOf(id: Id): (Row & { from: Id; to: Id })[];
  closed(row: Row): boolean;
  ready(): boolean;
  links(): LinkInfo[];
  run(query: string, limit?: number): { items: Row[]; links: (Row & { from: Id; to: Id })[]; more: number };
  watch(on: () => void): () => void;
}

const DIALS = "field.dials";
const QUERY = "find.query";
const REMEMBER = "archipelago.field.dials";

/** Where the field starts: what it draws, and where particles first lie. */
const START: Dial[] = [
  { key: "field_limit", label: "items at most", min: 50, max: 5000, step: 50, value: 2000, then: "seed", doc: "At most this many of the map's items, open and closed, are laid out." },
  { key: "seed_spread", label: "start spread", min: 0.5, max: 15, step: 0.1, value: 4.5, then: "seed", doc: "How widely particles start round the middle, for their count." },
];

const STYLE = `
.fl { display:grid; grid-template-rows:auto 1fr; height:100%; min-height:0; }
.fl-bar { display:flex; gap:8px; align-items:center; padding:5px 10px; border-bottom:1px solid var(--line); white-space:nowrap; min-width:0; }
.fl-body { display:flex; min-height:0; }
.fl-canvas { flex:1; min-width:0; position:relative; overflow:hidden; }
.fl-canvas canvas { width:100%; height:100%; display:block; cursor:grab; touch-action:none; }
.fl-side { width:min(380px, 40%); flex:none; border-left:1px solid var(--line); overflow:auto; }
.fl-tip { position:absolute; pointer-events:none; background:var(--panel); border:1px solid var(--line); border-radius:3px; padding:3px 7px; max-width:320px; box-shadow:0 2px 8px rgb(0 0 0 / 12%); }
.fl-tip .s { color:var(--dim); font-size:11px; }
.fl-key { position:absolute; left:8px; bottom:6px; color:var(--dim); font-size:11px; background:color-mix(in srgb, var(--bg) 88%, transparent); padding:4px 8px; border-radius:3px; border:1px solid var(--line); display:flex; flex-wrap:wrap; gap:2px 12px; max-width:calc(100% - 32px); pointer-events:none; }
.fl-key span { display:inline-flex; align-items:center; gap:4px; white-space:nowrap; }
.fl-key b { color:var(--fg); font-weight:600; }
.fl-key i { display:inline-block; width:9px; height:9px; border-radius:50%; }
.fl-key i.shut { opacity:0.3; background:var(--dim); }
.fl-key i.ring { background:transparent; border:2px solid var(--pick); width:7px; height:7px; }
.fl-key svg { width:20px; height:8px; }
.fl-empty { position:absolute; inset:0; display:grid; place-items:center; color:var(--dim); pointer-events:none; }
${PANEL_STYLE}
`;

const fieldPack: Pack = {
  id: "field",
  inject: ["find.index", "here.read", "here.set", "here.declare", "slot.fill", "slot.read"],
  apply(ctx: Context) {
    const index = ctx.get<FindIndex>("find.index");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    const slots = ctx.get<SlotRead>("slot.read");
    ctx.get<HereDeclare>("here.declare").declare({ key: DIALS, scope: "page", doc: "The field's dials that differ from where they start, by key." });

    const remembered = (): Settings => {
      try {
        const v = JSON.parse(localStorage.getItem(REMEMBER) ?? "{}");
        return v && typeof v === "object" ? v : {};
      } catch {
        return {};
      }
    };
    if (here.get(DIALS) === undefined) {
      const r = remembered();
      if (Object.keys(r).length) set.set(DIALS, r);
    }

    const useHere = <T extends Json>(key: string): T | undefined => {
      const [v, setV] = useState<T | undefined>(here.get<T>(key));
      useEffect(() => here.watch(key, (c) => setV(c.value as T | undefined)) as () => void, [key]);
      return v;
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

    /** Every item, open and closed (as the old lens "The whole map as particles"), up to `limit`, and the links among them. */
    const whole = (limit: number) => {
      const open = index.run("is:open", limit), shut = index.run("is:closed", limit);
      const items = [...open.items, ...shut.items].slice(0, limit);
      const ids = new Set(items.map((r) => r.id));
      const links = new Map<Id, Row & { from: Id; to: Id }>();
      for (const id of ids) for (const l of index.linksOf(id)) if (ids.has(l.from) && ids.has(l.to)) links.set(l.id, l);
      return { items, links: [...links.values()], more: open.items.length + open.more + shut.items.length + shut.more - items.length };
    };

    const View = () => {
      const [version, tick] = useState(0);
      useEffect(() => index.watch(() => tick((x) => x + 1)) as () => void, []);
      const q = useHere<string>(QUERY) ?? "";
      const picked = useHere<string>(KEYS.item);
      const over = (useHere<Record<string, number>>(DIALS) ?? {}) as Settings;
      const linkNames = index.links().map((l) => l.name).join(" ");
      // Every dial, by section: the start, each behaviour, the run, the drawing.
      const sections = useMemo<Section[]>(() => {
        const links = linkNames.split(" ").filter(Boolean);
        return [
          { key: "start", title: "start", doc: "What is drawn, and where particles start.", dials: START },
          ...BEHAVIOURS.map((b) => ({ key: b.name, title: b.name, doc: b.doc, behaviour: b, dials: b.dials({ links }) })),
          { key: "run", title: "run", doc: "How the run cools and moves.", dials: RUN },
          { key: "draw", title: "draw", doc: "How particles, links and words are drawn.", dials: DRAW },
        ];
      }, [linkNames]);
      const all = useMemo(() => sections.flatMap((s) => s.dials), [sections]);
      const S = useMemo(() => ({ ...defaults(all), ...over }), [all, JSON.stringify(over)]);

      // The layout is always the whole map: the find line never moves a particle, it only lights what it finds.
      // Worked out again only when the map or the limit changes, never on a hover or a query.
      const result = useMemo(() => whole(S.field_limit!), [version, S.field_limit]);
      const found = useMemo(() => (q.trim() ? new Set(index.run(q, S.field_limit).items.map((r) => r.id)) : null), [version, q, S.field_limit]);
      const shape = useMemo(() => JSON.stringify([result.items.map((r) => [r.id, r.fields.title, r.fields.status]), result.links.map((l) => l.id)]), [result]);
      const input = useMemo<FieldIn>(
        () => ({
          items: result.items.map((r) => ({ id: r.id, title: String(r.fields.title ?? r.id), type: r.type, status: String(r.fields.status ?? ""), closed: index.closed(r) })),
          links: result.links.map((l) => ({ id: l.id, type: l.type, from: l.from, to: l.to })),
        }),
        [shape],
      );

      const box = useRef<HTMLCanvasElement>(null);
      const engine = useRef<Field | null>(null);
      const [tip, setTip] = useState<{ title: string; sub: string; x: number; y: number } | null>(null);
      useEffect(() => {
        const f = field(box.current!, S, { open: (id) => set.set(KEYS.item, id), hover: setTip });
        engine.current = f;
        (globalThis as { field?: Field }).field = f;
        return () => {
          f.destroy();
          engine.current = null;
        };
      }, []);
      useEffect(() => engine.current?.input(input), [input]);
      useEffect(() => engine.current?.found(found), [found, input]);

      const last = useRef<Settings>(S);
      useEffect(() => {
        const prev = last.current;
        last.current = S;
        const changed = all.filter((d) => prev[d.key] !== S[d.key]);
        const toggled = Object.keys(S).some((k) => k.startsWith("on_") && prev[k] !== S[k]) || Object.keys(prev).some((k) => k.startsWith("on_") && !(k in S));
        if (!changed.length && !toggled) return;
        const thens = new Set(changed.map((d) => d.then ?? "warm"));
        if (toggled) thens.add("warm");
        const then = thens.has("seed") ? "seed" : thens.has("size") ? "size" : thens.has("warm") ? "warm" : "paint";
        if (changed.some((d) => d.key === "field_limit")) return void engine.current?.settings(S, "paint");
        engine.current?.settings(S, then);
      }, [S]);
      // A change to the map warms the run through input(); a new limit also reseeds once the new input lands.
      const lastStart = useRef(`${S.field_limit}`);
      useEffect(() => {
        const k = `${S.field_limit}`;
        if (k !== lastStart.current) (lastStart.current = k), engine.current?.reseed();
      }, [input]);

      const setDial = (key: string, v: number | undefined) => {
        const next: Settings = { ...over };
        const start = all.find((d) => d.key === key)?.value;
        if (v === undefined || v === start) delete next[key];
        else next[key] = v;
        if (key.startsWith("on_")) {
          const b = BEHAVIOURS.find((x) => `on_${x.name}` === key);
          if (b && (v ? 1 : 0) === (b.on ? 1 : 0)) delete next[key];
        }
        try {
          localStorage.setItem(REMEMBER, JSON.stringify(next));
        } catch {
          // This browser keeps nothing: the dials still hold for the page.
        }
        set.set(DIALS, Object.keys(next).length ? next : undefined);
      };

      // The legend: each type's colour and count, then what faded, lines and the ring mean.
      const legend = useMemo(() => {
        const count = new Map<string, number>();
        for (const it of input.items) count.set(it.type, (count.get(it.type) ?? 0) + 1);
        return typeColours(input.items.map((it) => it.type)).map((t) => ({ ...t, n: count.get(t.name) ?? 0 }));
      }, [input]);

      return html`
        <div class="fl">
          <div class="fl-bar"><${Slot} name="map.bar" /></div>
          <div class="fl-body">
            <${Panel}
              sections=${sections}
              S=${S}
              set=${setDial}
              reset=${() => {
                try {
                  localStorage.removeItem(REMEMBER);
                } catch {
                  // Nothing kept.
                }
                set.set(DIALS, undefined);
              }}
              stats=${() => engine.current?.stats()}
              reseed=${() => engine.current?.reseed()}
              fit=${() => engine.current?.fit()}
              found=${found ? found.size : null}
            />
            <div class="fl-canvas">
              <canvas ref=${box} title="Click a particle to open it; drag a particle to move it; drag the sea to pan; wheel to zoom; double-click the sea to fit"></canvas>
              ${tip && html`<div class="fl-tip" style=${`left:${tip.x + 14}px; top:${tip.y + 12}px`}><div>${tip.title}</div><div class="s">${tip.sub}</div></div>`}
              ${input.items.length > 0 &&
              html`<div class="fl-key">
                ${legend.map((t) => html`<span key=${t.name}><i style=${`background:${t.colour}`}></i><b>${t.name}</b> ${t.n}</span>`)}
                <span><i class="shut"></i> closed</span>
                <span><svg viewBox="0 0 20 8"><path d="M0 4H20" stroke="currentColor" stroke-width="1" /></svg> a link</span>
                <span><i class="ring"></i> pointed at, with its links</span>
              </div>`}
              ${!result.items.length && html`<div class="fl-empty">${index.ready() ? "Nothing matches." : "Reading the map…"}</div>`}
            </div>
            ${picked && html`<div class="fl-side"><${Slot} name="map.side" /></div>`}
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
    ctx.get<SlotFill>("slot.fill").fill({ slot: "shell.main", name: "field", title: "Field", view: View });
  },
};

export default fieldPack;
