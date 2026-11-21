/**
 * The field pack, page side: the map as particles, the view "Field" in the
 * frame's `center`, beside "Map". Each item is a particle in its type's
 * colour and links are faint lines; clusters come from the links alone.
 * Composable behaviours settle it (step.ts, behaviours/).
 *
 * - `center`: the canvas, with the legend that is also the filter. The
 *   layout is the whole map, open and closed (up to `field_limit` items),
 *   less what the legend hides. While the find line (`find.query`) has
 *   words, only what it finds and what lies near it (`find_steps`, then
 *   `find_faint`) stay, settled again and fitted to the view.
 * - The legend's "dials" tab: the run line and every dial. Each
 *   behaviour, and every number it reads, is one. Their values are `field.dials` and what the
 *   legend hides is `field.hide` (both page scope), so an agent can set
 *   them; this browser also remembers them.
 * - Hovering a particle lights it and its links; a click sets `here.item`,
 *   and the item page opens in `right`.
 * - It only shows: nothing here writes to the map.
 */
import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { Id, Json } from "../../spec/common.ts";
import type { HereDeclare, HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import { onStyle, shape as shapeOf, SHAPES, sheet, side as sideOf, SIDES } from "../../spec/style.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import type { LinkInfo, TypeInfo } from "../../spec/types.ts";
import type { Dial } from "./behaviour.ts";
import { field, type Field } from "./engine.ts";
import type { FieldIn, Settings } from "./graph.ts";
import { around, facets as facetsOf, FIND, shown, type Hide } from "./filter.ts";
import { Legend, LEGEND_STYLE } from "./legend.ts";
import { DRAW, palette } from "./paint.ts";
import { Panel, PANEL_STYLE, type Section } from "./panel.ts";
import { BEHAVIOURS, RUN, defaults, step } from "./step.ts";
import { build, seed } from "./graph.ts";
import { descends, type Verdict } from "./descends.ts";

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
  types(): TypeInfo[];
  type(name: string): TypeInfo | undefined;
  run(query: string, limit?: number): { items: Row[]; links: (Row & { from: Id; to: Id })[]; more: number };
  watch(on: () => void): () => void;
}

const DIALS = "field.dials";
const QUERY = "find.query";
const REMEMBER = "archipelago.field.dials";
const HIDE = "field.hide";
const REMEMBER_HIDE = "archipelago.field.hide";
/** What the legend hides until someone says otherwise: closed items, so Field opens on the work still open. */
export const HIDE_START: Hide = { closed: true };

/** Field's view in `center`, as the frame names it in `here.view`. */
export const VIEW = "field/field";

/** Where the field starts: what it draws, and where particles first lie. */
const START: Dial[] = [
  { key: "field_limit", label: "items at most", min: 50, max: 5000, step: 50, value: 2000, then: "seed", doc: "At most this many of the map's items, open and closed, are laid out." },
  { key: "seed_spread", label: "start spread", min: 0.5, max: 15, step: 0.1, value: 4.5, then: "seed", doc: "How widely particles start round the middle, for their count." },
];

const STYLE = sheet(`
.fl-canvas { position:relative; overflow:hidden; height:100%; min-height:0; }
.fl-canvas canvas { width:100%; height:100%; display:block; cursor:grab; touch-action:none; }
.fl-tip { position:absolute; pointer-events:none; background:var(--panel); border:1px solid var(--line); border-radius:3px; padding:3px 7px; max-width:320px; box-shadow:0 2px 8px rgb(0 0 0 / 12%); }
.fl-tip .s { color:var(--dim); font-size:11px; }
.fl-empty { position:absolute; inset:0; display:grid; place-items:center; color:var(--dim); pointer-events:none; }
${PANEL_STYLE}
${LEGEND_STYLE}
`);

const remember = (key: string, v: Json | undefined) => {
  try {
    if (v === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // This browser keeps nothing: the value still holds for the page.
  }
};
const recall = (key: string): Json | undefined => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "null");
    return v && typeof v === "object" ? v : undefined;
  } catch {
    return undefined;
  }
};

const fieldPack: Pack = {
  id: "field",
  about: "The Field view: the whole map as particles, settled by gather, repel, springs, flow and collide.",
  inject: ["find.index", "here.read", "here.set", "here.declare", "slot.fill"],
  apply(ctx: Context) {
    const index = ctx.get<FindIndex>("find.index");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    const declare = ctx.get<HereDeclare>("here.declare");
    declare.declare({ key: DIALS, scope: "page", doc: "The field's dials that differ from where they start, by key." });
    declare.declare({ key: HIDE, scope: "page", doc: "What the field's legend hides: types, type:status, type:kind, open, closed, links, lone. The layout is what is left. Absent: closed items ({ closed: true }); {} hides nothing." });
    for (const [key, kept] of [[DIALS, REMEMBER], [HIDE, REMEMBER_HIDE]] as const) {
      const v = here.get(key) === undefined ? recall(kept) : undefined;
      // A kept {} for what is hidden still says something: show everything, not the start.
      if (v && (Object.keys(v).length || key === HIDE)) set.set(key, v);
    }


    /** The engine on the page now: the canvas makes it, the dials in `left` ask it. */
    let engineNow: Field | null = null;

    const useHere = <T extends Json>(key: string): T | undefined => {
      const [v, setV] = useState<T | undefined>(here.get<T>(key));
      useEffect(() => here.watch(key, (c) => setV(c.value as T | undefined)) as () => void, [key]);
      return v;
    };
    /** A count that moves on with every change to the map. */
    const useVersion = () => {
      const [version, tick] = useState(0);
      useEffect(() => index.watch(() => tick((x) => x + 1)) as () => void, []);
      return version;
    };
    /** Every dial, by section (the start, each behaviour, the run), and their values: shared by the canvas and the dials. */
    const useDials = () => {
      const over = (useHere<Json>(DIALS) ?? {}) as Settings;
      const linkNames = index.links().map((l) => l.name).join(" ");
      const sections = useMemo<Section[]>(() => {
        const links = linkNames.split(" ").filter(Boolean);
        return [
          { key: "start", title: "start", doc: "What is drawn, and where particles start.", dials: START },
          { key: "find", title: "find", doc: "While the find line has words: what it finds, and how much round it, is all that is laid out.", dials: FIND },
          ...BEHAVIOURS.map((b) => ({ key: b.name, title: b.name, doc: b.doc, behaviour: b, dials: b.dials({ links }) })),
          { key: "run", title: "run", doc: "How the run cools and moves.", dials: RUN },
          { key: "draw", title: "draw", doc: "How particles, links and words are drawn.", dials: DRAW },
        ];
      }, [linkNames]);
      const all = useMemo(() => sections.flatMap((s) => s.dials), [sections]);
      const S = useMemo(() => ({ ...defaults(all), ...over }), [all, JSON.stringify(over)]);
      const setDial = (key: string, v: number | undefined) => {
        const next: Settings = { ...over };
        const start = all.find((d) => d.key === key)?.value;
        if (v === undefined || v === start) delete next[key];
        else next[key] = v;
        const b = BEHAVIOURS.find((x) => `on_${x.name}` === key);
        if (b && (v ? 1 : 0) === (b.on ? 1 : 0)) delete next[key];
        const value = Object.keys(next).length ? next : undefined;
        remember(REMEMBER, value);
        set.set(DIALS, value);
      };
      return { sections, all, S, setDial };
    };

    /** Every item, open and closed, up to `limit`, and the links among them. */
    const whole = (limit: number) => {
      const open = index.run("is:open", limit), shut = index.run("is:closed", limit);
      const items = [...open.items, ...shut.items].slice(0, limit);
      const ids = new Set(items.map((r) => r.id));
      const links = new Map<Id, Row & { from: Id; to: Id }>();
      for (const id of ids) for (const l of index.linksOf(id)) if (ids.has(l.from) && ids.has(l.to)) links.set(l.id, l);
      return { items, links: [...links.values()] };
    };

    /** What the field lays out, from rows: each particle's shape is its base's mark shape, and how full it is where its status sits (spec/style.ts). */
    const inputOf = (result: ReturnType<typeof whole>): FieldIn => {
      const bases = index.types().filter((t) => t.base === t.name).map((t) => t.name);
      const mark = (r: Row) => {
        const t = index.type(r.type);
        return { shape: SHAPES.indexOf(shapeOf(bases, t)), side: SIDES.indexOf(sideOf(t, r.fields.status)) };
      };
      return {
        items: result.items.map((r) => ({ id: r.id, title: String(r.fields.title ?? r.id), type: r.type, status: String(r.fields.status ?? ""), closed: index.closed(r), kind: typeof r.fields.kind === "string" ? r.fields.kind : "", ...mark(r) })),
        links: result.links.map((l) => ({ id: l.id, type: l.type, from: l.from, to: l.to })),
        // Every type on the map, in one order: each keeps its colour whatever the legend hides.
        types: [...new Set(result.items.map((r) => r.type))].sort(),
      };
    };

    /** `center`: the canvas and its legend. */
    const Canvas = () => {
      const version = useVersion();
      const q = useHere<string>(QUERY) ?? "";
      const { all, S } = useDials();

      // Worked out again only when the map or the limit changes, never on a hover or a query.
      const result = useMemo(() => whole(S.field_limit!), [version, S.field_limit]);
      const found = useMemo(() => (q.trim() ? new Set(index.run(q, S.field_limit).items.map((r) => r.id)) : null), [version, q, S.field_limit]);
      const shape = useMemo(() => JSON.stringify([result.items.map((r) => [r.id, r.fields.title, r.fields.status]), result.links.map((l) => l.id)]), [result]);
      const input = useMemo<FieldIn>(() => inputOf(result), [shape]);

      // What the legend hides is left out of the layout: a change to it settles the graph again with what is left.
      const hide = (useHere<Json>(HIDE) ?? HIDE_START) as Hide;
      const hideKey = JSON.stringify(hide);
      const [styled, restyle] = useState(0);
      useEffect(() => onStyle(() => restyle((n) => n + 1)), []);
      const facets = useMemo(() => facetsOf(input, hide, palette()), [input, hideKey, styled]);
      // While the find line has words, open and closed are not switched: a plan shows its done steps beside the rest.
      const visible = useMemo<FieldIn>(() => {
        const { open: _open, closed: _closed, ...kept } = hide;
        const by = found ? kept : hide;
        if (!Object.keys(by).length) return input;
        const vis = shown(input, by);
        return { items: input.items.filter((it) => vis.items.has(it.id)), links: input.links.filter((l) => vis.links.has(l.id)), types: input.types };
      }, [input, hideKey, !!found]);
      // While the find line has words, only what it finds and what lies near it stay: each by how it is drawn.
      const levels = useMemo(() => (found ? around(visible, found, S.find_steps!, S.find_faint!) : null), [visible, found, S.find_steps, S.find_faint]);
      const laid = useMemo<FieldIn>(() => {
        if (!levels) return visible;
        return { items: visible.items.filter((it) => levels.has(it.id)), links: visible.links.filter((l) => levels.has(l.from) && levels.has(l.to)), types: visible.types };
      }, [visible, levels]);
      // Kept as it is, {} included (show everything); only the start is absent.
      const setHide = (next: Hide | undefined) => {
        const v = (next ?? {}) as Json;
        remember(REMEMBER_HIDE, v);
        set.set(HIDE, v);
      };

      const box = useRef<HTMLCanvasElement>(null);
      const [tip, setTip] = useState<{ title: string; sub: string; x: number; y: number } | null>(null);
      useEffect(() => {
        const f = field(box.current!, S, { open: (id) => set.set(KEYS.item, id), hover: setTip });
        engineNow = f;
        (globalThis as { field?: Field }).field = f;
        return () => {
          f.destroy();
          if (engineNow === f) engineNow = null;
        };
      }, []);
      // A filter change warms the run to alpha_filter; a change to the map, to alpha_warm.
      // A new query (or new find dials) also fits the view to what is kept.
      const lastHide = useRef(hideKey), lastFind = useRef<Map<Id, number> | null>(levels);
      useEffect(() => {
        const byFind = lastFind.current !== levels;
        const byFilter = lastHide.current !== hideKey || byFind;
        lastHide.current = hideKey;
        lastFind.current = levels;
        engineNow?.found(levels);
        engineNow?.input(laid, byFilter ? S.alpha_filter : undefined, byFind);
      }, [laid]);

      // A dial's change does what it needs: a seed, new sizes, a warm run, or a paint.
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
        if (changed.some((d) => d.key === "field_limit")) return void engineNow?.settings(S, "paint");
        engineNow?.settings(S, then);
      }, [S]);
      // A new limit also seeds again, once the new input lands.
      const lastLimit = useRef(S.field_limit);
      useEffect(() => {
        if (S.field_limit !== lastLimit.current) (lastLimit.current = S.field_limit), engineNow?.reseed();
      }, [laid]);

      return html`
        <div class="fl-canvas">
          <canvas ref=${box}></canvas>
          ${tip && html`<div class="fl-tip" style=${`left:${tip.x + 14}px; top:${tip.y + 12}px`}><div>${tip.title}</div><div class="s">${tip.sub}</div></div>`}
          ${input.items.length > 0 && html`<${Legend} facets=${facets} hide=${hide} set=${setHide} dials=${() => html`<${Dials} />`} />`}
          ${!result.items.length && html`<div class="fl-empty">${index.ready() ? "Nothing to draw." : "Reading the map…"}</div>`}
        </div>
      `;
    };

    /** The legend's dials tab: the run line and every dial. */
    const Dials = () => {
      const version = useVersion();
      const q = useHere<string>(QUERY) ?? "";
      const { sections, S, setDial } = useDials();
      const found = useMemo(() => (q.trim() ? index.run(q, S.field_limit).items.length : null), [version, q, S.field_limit]);
      return html`<${Panel}
        sections=${sections}
        S=${S}
        set=${setDial}
        reset=${() => {
          remember(REMEMBER, undefined);
          set.set(DIALS, undefined);
        }}
        stats=${() => engineNow?.stats()}
        reseed=${() => engineNow?.reseed()}
        fit=${() => engineNow?.fit()}
        found=${found}
      />`;
    };

    /**
     * A section of Field's own page in the Packs view (docs' slot `docs.page`):
     * every behaviour, what it does, whether it is on, and whether it keeps the
     * rule (descends.ts) on the map in view now, checked here by the same
     * function the field's test runs.
     */
    const CHECK_MOST = 300;
    const Rule = ({ pack }: { pack: { id: string } }) => {
      const { S } = useDials();
      const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
      const [at, setAt] = useState(0);
      useEffect(() => {
        if (pack.id !== "field") return;
        let stop = false;
        // The field on the page now, or, with Field not open, the map's first items seeded and run a little.
        const g = engineNow?.graph() ?? (() => {
          const g0 = build(inputOf(whole(CHECK_MOST)), null);
          seed(g0, S);
          for (let k = 0; k < 60; k++) step(g0, S);
          return g0;
        })();
        const gather = BEHAVIOURS.find((b) => b.name === "gather")!;
        setVerdicts({});
        // One behaviour a tick, so the page stays live while it checks.
        BEHAVIOURS.forEach((b, k) =>
          setTimeout(() => {
            if (stop || !g.n) return;
            const v = descends(b, g, S, gather, undefined, CHECK_MOST);
            setVerdicts((was) => ({ ...was, [b.name]: v }));
          }, 30 * (k + 1)),
        );
        return () => void (stop = true);
      }, [pack.id, at]);
      if (pack.id !== "field") return null;
      const g = engineNow?.graph() ?? { n: Math.min(CHECK_MOST, index.run("is:open", CHECK_MOST).items.length) };
      return html`<section class="dk-sec">
        <h4>Behaviours, and the rule they keep</h4>
        <p class="dk-dim">Each behaviour lowers an energy of its own, and its push is that energy's downhill slope, so the run settles where the pushes balance. Checked by test/field.test.ts on every change, and here on ${engineNow ? `the map in Field (its first ${Math.min(CHECK_MOST, g.n)} of ${g.n} particles)` : `the map's first ${g.n} items`}, with the dials as they are.</p>
        ${BEHAVIOURS.map((b) => {
          const v = verdicts[b.name], on = (S[`on_${b.name}`] ?? (b.on ? 1 : 0)) > 0;
          const says = !v ? "checking…" : v.ok ? "✓ descends" : v.rises ? `✕ rises at step ${v.firstRise} (${v.rises} times)` : `✕ push off its slope by ${Math.round(v.slope * 100)}%`;
          return html`<p key=${b.name}>
            <b>${b.name}</b>${on ? "" : " (off)"} · <span class=${v && !v.ok ? "dk-warn" : ""} title=${v ? `energy ${v.from.toFixed(0)} → ${v.to.toFixed(0)} over 200 steps; push off its slope by ${(v.slope * 100).toFixed(1)}%` : ""}>${says}</span>
            <br /><span class="dk-dim">${b.doc}</span>
          </p>`;
        })}
        <p><button onClick=${() => setAt((n) => n + 1)}>Check again</button></p>
      </section>`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    const fill = ctx.get<SlotFill>("slot.fill");
    fill.fill({ slot: "center", name: "field", title: "Field", view: Canvas });
    fill.fill({ slot: "docs.page", name: "behaviours", view: Rule as any });
  },
};

export default fieldPack;
