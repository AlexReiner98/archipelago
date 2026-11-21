/**
 * The frame we ship (spec/frame.md): fills `root` with the six regions and
 * nothing in them. Top and bottom run across, left and right stand beside
 * the center, over floats above all. A region with no fills takes no room.
 * Center shows one fill at a time: the one `here.view` names, else the
 * first, and the frame sets `here.view` to what it shows. Left and right
 * stack their fills, sharing the height, each under its title when there
 * are two or more. Widths are style tokens. A side folds to a rail and
 * opens again (fold.ts): the folded fills are the page key `frame.folded`,
 * first the config's `folded`.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { HereDeclare, HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { Region, SlotFill, SlotRead } from "../../spec/slot.ts";
import { REGIONS, fillKey } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { sheet } from "../../spec/style.ts";
import { FOLDED, foldedOf, foldRegion, isRail } from "./fold.ts";

// htm ships CommonJS types; in the page its module export is the function itself.
const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

const STYLE = sheet(`
html, body { margin:0; height:100%; background:var(--bg); color:var(--fg); font:var(--text)/var(--leading) var(--font); }
#app { height:100%; }
.fr { display:grid; height:100%; grid-template-rows:auto minmax(0,1fr) auto; grid-template-columns:auto minmax(0,1fr) auto;
  grid-template-areas:"top top top" "left center right" "bottom bottom bottom"; }
.fr-top { grid-area:top; display:flex; align-items:baseline; gap:var(--space-5); padding:var(--space-3) var(--space-4) 0; border-bottom:1px solid var(--line); white-space:nowrap; }
.fr-top > * { min-width:0; }
.fr-bottom { grid-area:bottom; display:flex; align-items:center; gap:var(--space-5); padding:var(--space-2) var(--space-4); border-top:1px solid var(--line); color:var(--dim); font-size:var(--text-s); }
.fr-left, .fr-right { min-height:0; position:relative; display:flex; flex-direction:column; background:var(--panel); }
.fr-left { grid-area:left; width:min(var(--frame-left), 28vw); border-right:1px solid var(--line); }
.fr-right { grid-area:right; width:min(var(--frame-right), 32vw); border-left:1px solid var(--line); }
.fr-part { flex:1 1 0; min-height:0; overflow:auto; display:flex; flex-direction:column; }
.fr-part > :last-child { flex:1; min-height:0; }
.fr-part + .fr-part { border-top:1px solid var(--line); }
.fr-head { padding:var(--space-3) var(--space-4) 0; color:var(--dim); font-size:var(--text-s); cursor:pointer; }
.fr-head:hover, .fr-shut:hover { color:var(--fg); }
.fr-shut { flex:none; padding:var(--space-2) var(--space-4); color:var(--dim); font-size:var(--text-s); cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.fr-part + .fr-shut, .fr-shut + .fr-shut, .fr-shut + .fr-part { border-top:1px solid var(--line); }
.fr-center { grid-area:center; min-height:0; min-width:0; display:flex; }
.fr-center > * { flex:1; min-width:0; }
.fr-fold { position:absolute; top:50%; z-index:3; width:14px; height:40px; margin-top:-20px; padding:0; font:inherit; font-size:var(--text-xs); line-height:1; color:var(--dim); background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); cursor:pointer; opacity:.55; }
.fr-fold:hover { opacity:1; color:var(--fg); }
.fr-left > .fr-fold { right:-8px; } .fr-right > .fr-fold { left:-8px; }
.fr-rail { width:26px !important; cursor:pointer; align-items:center; padding-top:var(--space-3); gap:var(--space-3); color:var(--dim); font-size:var(--text-s); }
.fr-rail:hover { color:var(--fg); }
.fr-rail .t:hover { color:var(--pick); }
.fr-rail .t { writing-mode:vertical-rl; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-height:40vh; }
.fr-left.fr-rail .t { transform:rotate(180deg); }
.fr-over { position:fixed; inset:0; pointer-events:none; }
.fr-over > * { pointer-events:auto; }
`);

/** Redraws when any region's fills change. */
function useRegions(read: SlotRead) {
  const [, tick] = useState(0);
  useEffect(() => {
    const stops = REGIONS.map((r) => read.watch(r, () => tick((x) => x + 1)));
    tick((x) => x + 1);
    return () => void stops.forEach((s) => s());
  }, []);
}

const frame: Pack = {
  id: "frame",
  about: "The page's layout: a top, a bottom, two sides, a center, and a layer over them.",
  inject: ["slot.fill", "slot.read", "here.read", "here.set", "here.declare"],
  apply(ctx: Context, config: { folded?: string[] } = {}) {
    const read = ctx.get<SlotRead>("slot.read");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    ctx.effect(() => ctx.get<HereDeclare>("here.declare").declare({ key: FOLDED, scope: "page", doc: "The fills folded to a rail at the page's side, as pack/name." }));
    // The page starts with the config's folds, so any pack can open one by taking its fill out of the list.
    if (here.get(FOLDED) === undefined && config.folded?.length) set.set(FOLDED, [...config.folded]);

    const useFolded = (): string[] => {
      const [v, setV] = useState(() => foldedOf(here.get(FOLDED), config.folded));
      useEffect(() => here.watch(FOLDED, (c) => setV(foldedOf(c.value, config.folded))) as () => void, []);
      return v;
    };

    /**
     * Left or right: every fill, stacked, each under its title (a click on it
     * shuts it to that one line); or, all folded, a rail whose titles open one
     * each, and the rest of it all.
     */
    const Side = ({ region }: { region: Region }) => {
      const fills = read.fills(region);
      const folded = useFolded();
      if (!fills.length) return null;
      const keys = fills.map(fillKey);
      const fold = (which: string[], on: boolean) => set.set(FOLDED, foldRegion(folded, which, on));
      const name = (f: (typeof fills)[number]) => f.title ?? fillKey(f).split("/").pop();
      if (isRail(keys, folded))
        return html`<div class=${`fr-${region} fr-rail`} title=${`Open ${fills.map(name).join(", ")}`} onClick=${() => fold(keys, false)}>
          <span>${region === "left" ? "›" : "‹"}</span>
          ${fills.map((f) => html`<span class="t" key=${fillKey(f)} title=${`Open ${name(f)}`} onClick=${(e: Event) => (e.stopPropagation(), fold([fillKey(f)], false))}>${name(f)}</span>`)}
        </div>`;
      return html`<div class=${`fr-${region}`}>
        ${fills.map((f) => {
          const k = fillKey(f);
          if (folded.includes(k)) return html`<div class="fr-shut" key=${k} title=${`Open ${name(f)}`} onClick=${() => fold([k], false)}>▸ ${name(f)}</div>`;
          return html`<div class="fr-part" key=${k}>${fills.length > 1 && html`<div class="fr-head" title=${`Shut ${name(f)}`} onClick=${() => fold([k], true)}>▾ ${name(f)}</div>`}<${f.view} /></div>`;
        })}
        <button class="fr-fold" title="Fold to the side" onClick=${() => fold(keys, true)}>${region === "left" ? "‹" : "›"}</button>
      </div>`;
    };

    const Frame = () => {
      useRegions(read);
      const [view, setView] = useState(here.get<string>(KEYS.view));
      useEffect(() => here.watch(KEYS.view, (c) => setView(c.value as string | undefined)) as () => void, []);
      const center = read.fills("center");
      const shown = center.find((f) => fillKey(f) === view) ?? center[0];
      const key = shown && fillKey(shown);
      useEffect(() => {
        if (key && key !== view) set.set(KEYS.view, key);
      }, [key, view]);
      return html`
        <div class="fr">
          ${read.fills("top").length > 0 && html`<div class="fr-top"><${read.Slot} name="top" /></div>`}
          <${Side} region="left" />
          <div class="fr-center">${shown && html`<${shown.view} key=${key} />`}</div>
          <${Side} region="right" />
          ${read.fills("bottom").length > 0 && html`<div class="fr-bottom"><${read.Slot} name="bottom" /></div>`}
          <div class="fr-over"><${read.Slot} name="over" /></div>
        </div>
      `;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "root", name: "frame", view: Frame });
  },
};

export default frame;
