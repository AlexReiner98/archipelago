/**
 * The legend: every mark the map draws, floated in the region `over` at the
 * bottom left while the map is shown. Each base with each of its statuses
 * (marks by the spec's rule, spec/style.md), what lit means, then each kind
 * of link. It only reads the types; turn it off and the map is unchanged.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { SlotFill } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { sheet } from "../../spec/style.ts";
import type { FindIndex } from "../find/index.ts";
import { mark, side } from "../map/marks.ts";

// htm ships CommonJS types; in the page its module export is the function itself.
const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

const STYLE = sheet(`
.lg { position:absolute; left:8px; bottom:6px; color:var(--dim); font-size:var(--text-s); background:color-mix(in srgb, var(--bg) 88%, transparent); padding:var(--space-2) var(--space-3); border-radius:var(--radius); border:1px solid var(--line); display:grid; grid-template-columns:auto 1fr; column-gap:10px; row-gap:1px; pointer-events:none; }
.lg .b { color:var(--fg); }
.lg .row { display:flex; gap:10px; white-space:nowrap; align-items:center; }
.lg .row > span { display:inline-flex; align-items:center; gap:3px; }
.lg .m { display:inline-block; width:1.1em; text-align:center; }
.lg .m.s-fresh { color:var(--mark-fresh); } .lg .m.s-moving { color:var(--mark-moving); } .lg .m.s-done { color:var(--mark-done); } .lg .m.s-gone { color:var(--mark-gone); }
.lg svg { width:22px; height:8px; vertical-align:middle; }
.lg .sw { display:inline-block; width:16px; height:9px; border-radius:2px; border:1px solid var(--line); background:var(--panel); }
.lg .sw.pick { border:2px solid var(--pick); width:14px; height:7px; }
.lg .sw.near { background:var(--lit); }
.lg-wire { fill:none; stroke:var(--dim); stroke-width:1.2; }
.lg-wire.part_of { stroke-dasharray:5 3; }
.lg-wire.bears_on { stroke-dasharray:1 3; stroke-linecap:round; stroke-width:1.6; }
.lg-wire.waits_on { stroke-dasharray:7 3 1.5 3; }
.lg-wire.about { stroke:var(--line); }
.lg-wire.lit { stroke:var(--pick); stroke-width:2.2; }
`);

const KNOWN = new Set(["depends_on", "part_of", "waits_on", "bears_on", "about"]);

const legend: Pack = {
  id: "legend",
  about: "The Map's legend: what each mark and line means.",
  inject: ["find.index", "slot.fill"],
  apply(ctx: Context) {
    const index = ctx.get<FindIndex>("find.index");

    const Legend = () => {
      const [, tick] = useState(0);
      useEffect(() => index.watch(() => tick((x) => x + 1)) as () => void, []);
      const bases = index.types().filter((t) => t.base === t.name);
      const names = bases.map((t) => t.name);
      const wire = (cls: string) => html`<svg viewBox="0 0 22 8"><path class=${`lg-wire ${cls}`} d="M0 4H22" /></svg>`;
      return html`
        <div class="lg">
          ${bases.map(
            (t) => html`
              <span class="b">${t.name}</span>
              <span class="row">
                ${[...t.statuses.open, ...t.statuses.closed].map((st) => html`<span><span class=${`m s-${side(t, st)}`}>${mark(names, t, st)}</span>${st}</span>`)}
              </span>
            `,
          )}
          <span class="b">lit</span>
          <span class="row">
            <span><span class="sw pick"></span> hovered or open</span>
            <span><span class="sw near"></span> linked to it</span>
            <span>${wire("lit")} its links</span>
          </span>
          <span class="b">links</span>
          <span class="row">${index.links().map((l) => html`<span>${wire(KNOWN.has(l.name) ? l.name : "")} ${l.name}</span>`)}</span>
        </div>
      `;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "over", name: "legend", when: { "here.view": "map/map" }, view: Legend });
  },
};

export default legend;
