/**
 * The reciprocal plugin, page side: the view "Reciprocal" in the frame's
 * `center`. A mesh is solved as a reciprocal frame: each edge a beam (a
 * cylinder), each beam two agents (its ends) in the Landscape's particle
 * arrays, settled by the field's step. Beside the canvas:
 *
 * - **Frame**: which frame is shown. A frame kept on the map (map.ts) is
 *   its items: its mesh, its dials and each beam's own diameter are read
 *   from them and changed only through its actions, so every change is in
 *   the history and undone like any other. **Scratch** is a frame not kept:
 *   page state, until **Keep on the map** makes it one. A kept frame is
 *   solved on the server with **Solve and keep**, which records the result.
 * - **Rules**: the solve's DAG (pipeline.ts), each rule with what it made
 *   and whether it ran on the last change, the live ones as they go.
 * - **Beam**: click a beam (shift adds) to tune its own diameter; it shows
 *   what the beam rests on and carries, each contact's gap, and its DAG
 *   level. On a kept frame the beam picked is `here.item`, so every panel
 *   that follows the item follows it.
 * - The slot `reciprocal.side`: what other plugins show beside the frame
 *   (the review plugin's issues).
 * - **Dials**: the input, each agent rule, the DAG's sweep, the run and
 *   the drawing (the field's panel).
 *
 * Page state: `reciprocal.frame` (the frame shown), `reciprocal.dials`
 * (the drawing's dials, and a scratch frame's), `reciprocal.diameters` (a
 * scratch frame's own diameters, by `<mesh>.<detail>.<beam>`) and
 * `reciprocal.beams` (picked, by index). The browser remembers the first
 * three.
 */
import { h } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import type { Id, Json } from "../../spec/common.ts";
import type { GraphRead, GraphWatch, Item } from "../../spec/graph.ts";
import type { HereDeclare, HereRead, HereSet } from "../../spec/here.ts";
import type { SlotDeclare, SlotFill, SlotRead } from "../../spec/slot.ts";
import { sheet } from "../../spec/style.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import type { Settings } from "../field/graph.ts";
import { Panel, PANEL_STYLE, type Section } from "../field/panel.ts";
import { AGENTS, ENGAGE, SWEEP } from "./agents.ts";
import { DRAW_HERE, INPUT } from "./dials.ts";
import { engine, type Engine, type Hover } from "./engine.ts";
import { diameterKey } from "./pipeline.ts";
import { Beam, BEAM_STYLE } from "./inspect.ts";
import { Rules, RULES_STYLE } from "./diagram.ts";
import { MESHES } from "./mesh.ts";
import { BY, FRAME, SOLVE, load, type Loaded } from "./map.ts";
import { FIXED, RUN_DIALS, START, isDesign, isDraw, settingsOf } from "./settings.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

const DIALS = "reciprocal.dials";
const DIAMETERS = "reciprocal.diameters";
const BEAMS = "reciprocal.beams";
const FRAME_KEY = "reciprocal.frame";
const REMEMBER = "archipelago.reciprocal.dials";
const REMEMBER_D = "archipelago.reciprocal.diameters";
const REMEMBER_F = "archipelago.reciprocal.frame";

/** Where other plugins show what they have to say beside the frame. */
export const SIDE = "reciprocal.side";

/** The view in `center`, as the frame names it in `here.view`. */
export const VIEW = "reciprocal/reciprocal";

/** A dial moved writes once it has been still this long, so a drag is one change set. */
const STILL_MS = 400;

const HUMAN = (basis: string) => ({ of: "human" as const, basis });

const SECTIONS: Section[] = [
  { key: "input", title: "input", doc: "The seeded mesh, the fans' turn, how far in each end rests, and every beam's diameter.", dials: [...INPUT, ENGAGE] },
  ...AGENTS.map((b) => ({ key: b.name, title: b.name, doc: b.doc, behaviour: b, dials: b.dials({ links: [] }) })),
  { key: "dag", title: "DAG sweep", doc: "Each step, before the pushes: every resting end moved toward where it rests, from the supports up.", dials: [SWEEP] },
  { key: "run", title: "run", doc: "The Landscape's run dials, started here for a frame in centimetres.", dials: RUN_DIALS },
  { key: "draw", title: "draw", doc: "How the frame is drawn.", dials: DRAW_HERE },
];

const STYLE = sheet(`
.rf { display:grid; grid-template-columns:1fr 320px; height:100%; min-height:0; }
.rf-canvas { position:relative; overflow:hidden; min-height:0; }
.rf-canvas canvas { width:100%; height:100%; display:block; cursor:grab; touch-action:none; }
.rf-canvas canvas:active { cursor:grabbing; }
.rf-none { position:absolute; inset:0; display:grid; place-items:center; color:var(--dim); }
.rf-tip { position:absolute; pointer-events:none; background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:3px 7px; font-size:var(--text-s); box-shadow:0 2px 8px rgb(0 0 0 / 12%); white-space:nowrap; }
.rf-tip .s { color:var(--dim); }
.rf-help { position:absolute; left:var(--space-4); bottom:var(--space-3); color:var(--dim); font-size:var(--text-xs); pointer-events:none; }
.rf-side { border-left:1px solid var(--line); overflow:auto; min-height:0; background:var(--bg); font-size:var(--text-m); }
.rf-side > h4, .rf-side h4.rf-h { margin:0; padding:var(--space-3) var(--space-4); font-size:var(--text-s); text-transform:uppercase; letter-spacing:.04em; color:var(--dim); border-bottom:1px solid var(--line); }
.rf-side .fl-panel { height:auto; overflow:visible; }
.rf-frame { padding:var(--space-3) var(--space-4); border-bottom:1px solid var(--line); display:flex; flex-direction:column; gap:var(--space-2); }
.rf-frame select { font:inherit; background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:var(--radius); padding:2px 4px; }
.rf-frame .row { display:flex; gap:var(--space-2); align-items:center; flex-wrap:wrap; }
.rf-frame button { font:inherit; font-size:var(--text-s); background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:var(--radius); padding:1px 8px; cursor:pointer; }
.rf-frame button:hover:not(:disabled) { border-color:var(--dim); }
.rf-frame button:disabled { opacity:.5; cursor:default; }
.rf-frame .hint, .rf-frame .solve { color:var(--dim); font-size:var(--text-s); }
.rf-frame .solve b { color:var(--fg); font-weight:600; }
.rf-frame .say { color:var(--failed); font-size:var(--text-s); }
${PANEL_STYLE}
${RULES_STYLE}
${BEAM_STYLE}
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
    return v && (typeof v !== "object" || Object.keys(v).length) ? v : undefined;
  } catch {
    return undefined;
  }
};

/** A scratch frame's own diameters are kept per mesh: `<mesh>.<detail>.<beam>`. */
const meshOf = (S: Settings) => `${S.mesh}.${S.detail}`;

const only = (o: Settings, keep: (k: string) => boolean): Settings => Object.fromEntries(Object.entries(o).filter(([k]) => keep(k)));

/** A frame kept on the map, as the page reads it: what `load` reads, and its newest solve. */
interface Shown extends Loaded {
  solve: Item | null;
  byIndex: Record<number, Id>;
}

const reciprocal: Plugin = {
  id: "reciprocal",
  about: "The Reciprocal view: a mesh solved as a reciprocal frame, its beams' ends as agents settled by the Landscape's step, the solve a DAG of rules, kept on the map as items.",
  inject: ["here.read", "here.set", "here.declare", "slot.fill", "slot.declare", "slot.read", "graph.read", "graph.watch", "action.invoke"],
  apply(ctx: Context) {
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    const declare = ctx.get<HereDeclare>("here.declare");
    const graph = ctx.get<GraphRead>("graph.read");
    const watch = ctx.get<GraphWatch>("graph.watch");
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    const Slot = ctx.get<SlotRead>("slot.read").Slot;
    ctx.get<SlotDeclare>("slot.declare").declare({ name: SIDE, merge: "many", doc: "Beside a reciprocal frame, under the beam picked: what another plugin has to say about the item shown (here.item), such as its review issues." });
    declare.declare({ key: FRAME_KEY, scope: "page", doc: "The frame shown in the Reciprocal view, by id; none, a scratch frame not kept." });
    declare.declare({ key: DIALS, scope: "page", doc: "The reciprocal view's dials that differ from where they start, by key: the drawing's, and a scratch frame's." });
    declare.declare({ key: DIAMETERS, scope: "page", doc: "A scratch frame's own beam diameters in cm, by <mesh>.<detail>.<beam>." });
    declare.declare({ key: BEAMS, scope: "page", doc: "The beams picked in the Reciprocal view, by index." });
    for (const [key, kept] of [[DIALS, REMEMBER], [DIAMETERS, REMEMBER_D], [FRAME_KEY, REMEMBER_F]] as const) {
      const v = here.get(key) === undefined ? recall(kept) : undefined;
      if (v) set.set(key, v);
    }

    const act = async (action: string, input: Record<string, Json>, basis: string, reason: string) => {
      const out = await invoke.invoke({ action, input, authority: HUMAN(basis), reason });
      return out;
    };

    /** The frame, its beams by index and its newest current solve. */
    const show = async (id: Id): Promise<Shown | null> => {
      try {
        const l = await load(graph, id);
        const byIndex: Record<number, Id> = {};
        for (const b of l.beams) byIndex[b.fields.index as number] = b.id;
        const about = await graph.links(id, { type: "about", dir: "in" }, { limit: 500 });
        const recs = (await graph.get(about.items.map((x) => x.from))).filter(
          (r): r is Item => !!r && r.type === "record" && r.fields.kind === SOLVE && r.fields.status === "current" && (r.fields.value as { by?: string } | null)?.by === BY,
        );
        return { ...l, byIndex, solve: recs.at(-1) ?? null };
      } catch {
        return null;
      }
    };

    const useHere = <T extends Json>(key: string): T | undefined => {
      const [v, setV] = useState<T | undefined>(here.get<T>(key));
      useEffect(() => here.watch(key, (c) => setV(c.value as T | undefined)) as () => void, [key]);
      return v;
    };

    /** The frames kept on the map, current ones, newest last. */
    const useFrames = (): Item[] => {
      const [list, setList] = useState<Item[]>([]);
      useEffect(() => {
        let live = true;
        const go = () => graph.of(FRAME.name, { limit: 200 }).then((p) => live && setList(p.items.filter((i) => i.fields.status === "current")));
        void go();
        const stop = watch.watch({ types: [FRAME.name] }, () => void go());
        return () => {
          live = false;
          stop();
        };
      }, []);
      return list;
    };

    /** The frame shown, read again whenever it, its beams or a record changes. */
    const useShown = (id: Id | undefined): Shown | null => {
      const [s, setS] = useState<Shown | null>(null);
      useEffect(() => {
        if (!id) return void setS(null);
        let live = true;
        let t: ReturnType<typeof setTimeout> | undefined;
        const go = () => show(id).then((x) => live && setS(x));
        void go();
        const stop = watch.watch({ types: [FRAME.name, "beam", "record"] }, () => {
          clearTimeout(t);
          t = setTimeout(go, 80);
        });
        return () => {
          live = false;
          clearTimeout(t);
          stop();
        };
      }, [id]);
      return s && s.item.id === id ? s : null;
    };

    const FrameBar = ({ frames, shown, frameId, keep, solve, say }: {
      frames: Item[];
      shown: Shown | null;
      frameId: Id | undefined;
      keep: () => void;
      solve: () => void;
      say: string;
    }) => {
      const choose = (v: string) => {
        set.set(BEAMS, undefined);
        set.set(FRAME_KEY, v || undefined);
        remember(REMEMBER_F, v || undefined);
        set.set("here.item", v || undefined);
      };
      const sv = shown?.solve?.fields.value as { worst?: number; settled?: boolean } | undefined;
      return html`<div class="rf-frame">
        <div class="row">
          <select aria-label="frame" value=${frameId ?? ""} onChange=${(e: Event) => choose((e.target as HTMLSelectElement).value)}>
            <option value="">Scratch: not kept</option>
            ${frames.map((f) => html`<option key=${f.id} value=${f.id}>${String(f.fields.title ?? f.id)}</option>`)}
          </select>
          ${frameId
            ? html`<button onClick=${solve} disabled=${!shown} title="Solve this frame on the server and keep the result as a record about it">Solve and keep</button>`
            : html`<button onClick=${keep} title="Make this frame items on the map: its mesh, dials and each beam's own diameter">Keep on the map</button>`}
        </div>
        ${frameId
          ? shown
            ? html`<div class="hint">${shown.beams.length} beams on the map · every change is in the history</div>
                ${shown.solve
                  ? html`<div class="solve">Last kept solve: <b>${sv?.settled ? "settled" : "not settled"}</b>, worst gap <b>${((sv?.worst ?? 0) * 100).toFixed(1)}%</b></div>`
                  : html`<div class="solve">Not solved on the map yet.</div>`}`
            : html`<div class="hint">Reading the frame…</div>`
          : html`<div class="hint">Page state only: nothing here is on the map until it is kept.</div>`}
        ${say && html`<div class="say">${say}</div>`}
      </div>`;
    };

    const View = () => {
      const frameId = useHere<string>(FRAME_KEY);
      const frames = useFrames();
      const shown = useShown(frameId);
      const kept = !!frameId;
      const over = (useHere<Json>(DIALS) ?? {}) as Settings;
      const own = (useHere<Json>(DIAMETERS) ?? {}) as Record<string, number>;
      const picked = (useHere<Json>(BEAMS) ?? []) as number[];
      const [say, setSay] = useState("");

      // A kept frame's dials and diameters as moved on the page, until the map has them.
      const [pendingD, setPendingD] = useState<Record<string, number | null>>({});
      const [pendingB, setPendingB] = useState<Record<number, number | null>>({});
      const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
      const timerB = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
      const latest = useRef({ pendingD, pendingB, shown });
      latest.current = { pendingD, pendingB, shown };
      // Once the map holds a value, it is no longer pending.
      useEffect(() => {
        if (!shown) return;
        setPendingD((p) => only(p as Settings, (k) => (p[k] === null ? k in shown.kept.dials : shown.kept.dials[k] !== p[k])) as Record<string, number | null>);
        setPendingB((p) => Object.fromEntries(Object.entries(p).filter(([b, d]) => (shown.kept.diameters[Number(b)] ?? null) !== d)));
      }, [shown]);
      useEffect(() => (setPendingD({}), setPendingB({}), setSay("")), [frameId]);

      const S = useMemo(() => {
        if (kept && shown) {
          const dials = { ...shown.kept.dials };
          for (const [k, v] of Object.entries(pendingD)) v === null ? delete dials[k] : (dials[k] = v);
          const diameters = { ...shown.kept.diameters };
          for (const [b, d] of Object.entries(pendingB)) d === null ? delete diameters[Number(b)] : (diameters[Number(b)] = d);
          return settingsOf({ ...shown.kept, dials, diameters }, only(over, isDraw));
        }
        const dialS = { ...START, ...over };
        const prefix = `${meshOf(dialS)}.`;
        const ds: Settings = {};
        for (const [k, v] of Object.entries(own)) if (k.startsWith(prefix)) ds[diameterKey(Number(k.slice(prefix.length)))] = v;
        return { ...dialS, ...ds };
      }, [kept, shown, JSON.stringify(pendingD), JSON.stringify(pendingB), JSON.stringify(over), JSON.stringify(own)]);

      const flushDials = () => {
        const { pendingD: p, shown: s } = latest.current;
        if (!s || !Object.keys(p).length) return;
        const keys = Object.keys(p).join(", ");
        void act("reciprocal.dial", { frame: s.item.id, dials: p as Json }, "moved a dial in the Reciprocal view", `Set ${keys} on ${String(s.item.fields.title ?? s.item.id)}`).then(
          (o) => o.ok || (setSay(o.refused.message), setPendingD({})),
        );
      };
      const flushBeams = () => {
        const { pendingB: p, shown: s } = latest.current;
        if (!s || !Object.keys(p).length) return;
        // One change set for each value given: a drag over several beams is one.
        const byValue = new Map<number | null, Id[]>();
        for (const [b, d] of Object.entries(p)) {
          const id = s.byIndex[Number(b)];
          if (id) byValue.set(d, [...(byValue.get(d) ?? []), id]);
        }
        for (const [d, beams] of byValue)
          void act("reciprocal.diameter", { beams, diameter: d }, "set a beam's diameter in the Reciprocal view", `${d === null ? "Clear the own diameter of" : `Give ${d} cm to`} ${beams.length} beam${beams.length === 1 ? "" : "s"}`).then(
            (o) => o.ok || (setSay(o.refused.message), setPendingB({})),
          );
      };

      const setDial = (key: string, v: number | undefined) => {
        if (kept && isDesign(key)) {
          if (FIXED.includes(key)) return setSay(`A kept frame's ${key} is fixed. Pick Scratch to try another.`);
          setSay("");
          setPendingD((p) => ({ ...p, [key]: v === undefined ? null : v }));
          clearTimeout(timer.current);
          timer.current = setTimeout(flushDials, STILL_MS);
          return;
        }
        const next: Settings = { ...over };
        const start = START[key];
        const b = AGENTS.find((x) => `on_${x.name}` === key);
        if (v === undefined || v === start || (b && (v ? 1 : 0) === (b.on ? 1 : 0))) delete next[key];
        else next[key] = v;
        const value = Object.keys(next).length ? next : undefined;
        remember(REMEMBER, value);
        set.set(DIALS, value);
        if (key === "mesh" || key === "detail") set.set(BEAMS, undefined);
      };
      const setDiameter = (beams: number[], d: number | undefined) => {
        if (kept) {
          const v = d === undefined || d === S.diameter ? null : d;
          setPendingB((p) => ({ ...p, ...Object.fromEntries(beams.map((b) => [b, v])) }));
          clearTimeout(timerB.current);
          timerB.current = setTimeout(flushBeams, STILL_MS);
          return;
        }
        const next = { ...own };
        for (const b of beams) {
          const k = `${meshOf(S)}.${b}`;
          if (d === undefined || d === S.diameter) delete next[k];
          else next[k] = d;
        }
        const value = Object.keys(next).length ? next : undefined;
        remember(REMEMBER_D, value);
        set.set(DIAMETERS, value);
      };
      const clearDiameters = () => {
        if (kept && shown) {
          const beams = Object.keys(shown.kept.diameters).map((b) => shown.byIndex[Number(b)]).filter((x): x is Id => !!x);
          if (beams.length) void act("reciprocal.diameter", { beams, diameter: null }, "pressed Clear own diameters", `Clear ${beams.length} own diameters`);
          return;
        }
        const prefix = `${meshOf(S)}.`;
        const next = Object.fromEntries(Object.entries(own).filter(([k]) => !k.startsWith(prefix)));
        const value = Object.keys(next).length ? next : undefined;
        remember(REMEMBER_D, value);
        set.set(DIAMETERS, value);
      };
      const reset = () => {
        if (kept && shown && Object.keys(shown.kept.dials).length) {
          const dials = Object.fromEntries(Object.keys(shown.kept.dials).map((k) => [k, null]));
          void act("reciprocal.dial", { frame: shown.item.id, dials }, "pressed reset on the dials", `Put every dial of ${String(shown.item.fields.title ?? shown.item.id)} back where it starts`);
        }
        const draw = kept ? only(over, (k) => !isDraw(k)) : {};
        const value = Object.keys(draw).length ? draw : undefined;
        remember(REMEMBER, value);
        set.set(DIALS, value);
      };
      const pick = (beams: number[]) => {
        set.set(BEAMS, beams.length ? beams : undefined);
        if (kept && shown) set.set("here.item", (beams.length ? shown.byIndex[beams[0]!] : undefined) ?? shown.item.id);
      };
      const keep = async () => {
        const mesh = MESHES[S.mesh ?? 0]!;
        const dials = only(over, (k) => isDesign(k) && !FIXED.includes(k));
        const prefix = `${meshOf(S)}.`;
        const diameters = Object.fromEntries(Object.entries(own).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k.slice(prefix.length), v]));
        const title = `${mesh[0]!.toUpperCase()}${mesh.slice(1)} frame, detail ${S.detail}`;
        const o = await act("reciprocal.create", { title, mesh, detail: S.detail ?? 2, dials, diameters }, "pressed Keep on the map", `Keep the scratch ${mesh} frame on the map`);
        if (!o.ok) return setSay(o.refused.message);
        const id = (o.output as { frame: Id }).frame;
        set.set(FRAME_KEY, id);
        remember(REMEMBER_F, id);
        set.set("here.item", id);
        set.set(BEAMS, undefined);
      };
      const solve = async () => {
        if (!shown) return;
        setSay("");
        const o = await act("reciprocal.solve", { frame: shown.item.id }, "pressed Solve and keep", `Solve ${String(shown.item.fields.title ?? shown.item.id)}`);
        if (!o.ok) setSay(o.refused.message);
      };

      const box = useRef<HTMLCanvasElement>(null);
      const eng = useRef<Engine | null>(null);
      const [tip, setTip] = useState<Hover | null>(null);
      const [, tick] = useState(0);
      const [gl, setGl] = useState(true);
      const pickedNow = useRef(picked);
      pickedNow.current = picked;
      const pickNow = useRef(pick);
      pickNow.current = pick;
      useEffect(() => {
        let last = 0, trail: ReturnType<typeof setTimeout> | undefined;
        const e = engine(box.current!, {
          pick: (b, add) => {
            const was = pickedNow.current;
            if (b === null) return void (add || pickNow.current([]));
            pickNow.current(add ? (was.includes(b) ? was.filter((x) => x !== b) : [...was, b]) : [b]);
          },
          hover: setTip,
          // The live rules' words change every frame: the side redraws a few times a second, and once more after the last.
          ran: () => {
            const now = performance.now();
            clearTimeout(trail);
            if (now - last > 200) (last = now), tick((n) => n + 1);
            else trail = setTimeout(() => ((last = performance.now()), tick((n) => n + 1)), 200);
          },
        });
        eng.current = e;
        setGl(!!box.current!.getContext("webgl2"));
        (globalThis as { reciprocal?: Engine }).reciprocal = e;
        return () => {
          clearTimeout(trail);
          e.destroy();
          eng.current = null;
        };
      }, []);
      // A kept frame draws once it is read, not the scratch frame before it.
      const ready = !kept || !!shown;
      useEffect(() => void (ready && eng.current?.settings(S)), [S, ready]);
      useEffect(() => eng.current?.select(picked), [JSON.stringify(picked)]);

      const e = eng.current;
      const g = e?.graph() ?? null;
      const ownCount = Object.keys(S).filter((k) => /^d_\d+$/.test(k)).length;
      return html`
        <div class="rf">
          <div class="rf-canvas">
            <canvas ref=${box}></canvas>
            ${!gl && html`<div class="rf-none">This browser has no WebGL2, which the frame is drawn with.</div>`}
            ${tip && g && html`<div class="rf-tip" style=${`left:${tip.x + 14}px; top:${tip.y + 12}px`}>
              <div>beam ${tip.beam} · ⌀ ${(2 * g.rf.r[tip.beam]!).toFixed(1)} cm</div>
              <div class="s">level ${g.rf.rests.level[tip.beam]} · worst gap ${((e?.measure()?.worst[tip.beam] ?? 0) * 100).toFixed(1)}% · click to tune</div>
            </div>`}
            <div class="rf-help">drag to turn · shift-drag to pan · wheel to zoom · double-click to fit · click a beam to tune it, shift-click for more</div>
          </div>
          <div class="rf-side">
            <h4>Frame</h4>
            <${FrameBar} frames=${frames} shown=${shown} frameId=${frameId} keep=${keep} solve=${solve} say=${say} />
            <h4>Beam</h4>
            <${Beam} g=${g} mz=${e?.measure() ?? null} picked=${picked} S=${S} pick=${pick} setDiameter=${setDiameter} ownCount=${ownCount} clear=${clearDiameters} />
            ${kept && html`<${Slot} name=${SIDE} />`}
            <h4>Rules, as a DAG</h4>
            <${Rules} ev=${e?.evaluation()} />
            <h4>Dials</h4>
            <${Panel}
              sections=${SECTIONS}
              S=${S}
              set=${setDial}
              reset=${reset}
              stats=${() => e?.stats()}
              reseed=${() => e?.reseed()}
              fit=${() => e?.fit()}
              found=${null}
            />
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
    ctx.get<SlotFill>("slot.fill").fill({ slot: "center", name: "reciprocal", title: "Reciprocal", view: View });
  },
};

export default reciprocal;
