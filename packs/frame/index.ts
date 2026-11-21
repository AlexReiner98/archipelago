/**
 * The frame we ship (spec/frame.md): fills `root` with the six regions and
 * nothing in them. Top and bottom run across, left and right stand beside
 * the center, over floats above all. A region with no fills takes no room.
 * Center shows one fill at a time: the one `here.view` names, else the
 * first, and the frame sets `here.view` to what it shows. Left and right
 * stack their fills, each under its title. Widths are style tokens.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { Region, SlotFill, SlotRead } from "../../spec/slot.ts";
import { REGIONS, fillKey } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { sheet } from "../../spec/style.ts";

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
.fr-left, .fr-right { min-height:0; overflow:auto; display:flex; flex-direction:column; background:var(--panel); }
.fr-left { grid-area:left; width:var(--frame-left); border-right:1px solid var(--line); }
.fr-right { grid-area:right; width:var(--frame-right); border-left:1px solid var(--line); }
.fr-part + .fr-part { border-top:1px solid var(--line); }
.fr-head { padding:var(--space-3) var(--space-4) 0; color:var(--dim); font-size:var(--text-s); }
.fr-center { grid-area:center; min-height:0; min-width:0; display:flex; }
.fr-center > * { flex:1; min-width:0; }
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
  inject: ["slot.fill", "slot.read", "here.read", "here.set"],
  apply(ctx: Context) {
    const read = ctx.get<SlotRead>("slot.read");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");

    /** Left or right: every fill, stacked, each under its title. */
    const Side = ({ region }: { region: Region }) => {
      const fills = read.fills(region);
      if (!fills.length) return null;
      return html`<div class=${`fr-${region}`}>
        ${fills.map((f) => html`<div class="fr-part" key=${fillKey(f)}>${f.title && html`<div class="fr-head">${f.title}</div>`}<${f.view} /></div>`)}
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
