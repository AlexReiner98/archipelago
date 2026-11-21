/**
 * The style view: every token as it is drawn now, day and night side by
 * side. Colours as swatches, the marks for each base and verdict, the type
 * scale and the spaces. It reads the page's tokens (spec/style.md), not
 * the style pack's data, so it shows whatever style is loaded, or the
 * plain fallback when none is.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { SlotFill } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { glyph, HUES, onStyle, read, SHAPES, SIDES, sheet, VERDICTS, verdictGlyph, type Token } from "../../spec/style.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

const COLOURS: [string, Token[]][] = [
  ["page", ["bg", "panel", "fg", "dim", "line", "lit", "pick"]],
  ["verdicts", ["held", "failed", "quiet"]],
  ["marks", ["mark-fresh", "mark-moving", "mark-done", "mark-gone"]],
  ["exchange", ["say", "write", "fire"]],
  ["sources", ["owner", "learned", "schema"]],
  ["packs", [...HUES]],
  ["controls", ["control", "control-fg", "control-line"]],
];
const TYPE: Token[] = ["text-l", "text", "text-m", "text-s", "text-xs"];
const SPACE: Token[] = ["space-1", "space-2", "space-3", "space-4", "space-5", "radius"];

const STYLE = sheet(`
.sv { display:grid; grid-template-columns:1fr 1fr; height:100%; overflow:auto; }
.sv-half { background:var(--bg); color:var(--fg); padding:var(--space-4) var(--space-5); min-width:0; }
.sv-half + .sv-half { border-left:1px solid var(--line); }
.sv-head { font-weight:var(--bold); padding-bottom:var(--space-3); }
.sv-group { color:var(--dim); font-size:var(--text-s); padding:var(--space-3) 0 var(--space-1); border-bottom:1px solid var(--line); margin-bottom:var(--space-2); }
.sv-row { display:flex; flex-wrap:nowrap; gap:var(--space-5); white-space:nowrap; overflow:hidden; }
.sv-row > span { display:inline-flex; gap:var(--space-2); align-items:baseline; }
.sv-sw { display:inline-block; width:12px; height:12px; border-radius:var(--radius); box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--fg) 20%, transparent); align-self:center; }
.sv-n { color:var(--dim); font-size:var(--text-s); }
.sv-mk { width:1.1em; text-align:center; }
.sv-mk.s-fresh { color:var(--mark-fresh); } .sv-mk.s-moving { color:var(--mark-moving); } .sv-mk.s-done { color:var(--mark-done); } .sv-mk.s-gone { color:var(--mark-gone); }
.sv-mk.v-held { color:var(--held); } .sv-mk.v-failed { color:var(--failed); } .sv-mk.v-quiet, .sv-mk.v-none { color:var(--quiet); }
.sv-gap { display:inline-block; height:10px; background:var(--pick); }
.sv-ctl { font:inherit; background:var(--control); color:var(--control-fg); border:1px solid var(--control-line); border-radius:var(--radius); padding:0 var(--space-3); }
`);

const styleView: Pack = {
  id: "style-view",
  about: "The Style view: the colours, type and marks every view uses.",
  inject: ["slot.fill"],
  apply(ctx: Context) {
    const Half = ({ scheme }: { scheme: "light" | "dark" }) => html`
      <div class="sv-half" data-scheme=${scheme}>
        <div class="sv-head">${scheme === "light" ? "Day" : "Night"}</div>
        ${COLOURS.map(
          ([group, names]) => html`
            <div class="sv-group">${group}</div>
            <div class="sv-row">${names.map((n) => html`<span title=${`--${n}`}><span class="sv-sw" style=${`background:var(--${n})`}></span><span class="sv-n">${n}</span></span>`)}</div>
          `,
        )}
        <div class="sv-group">marks: fresh, moving, done, gone</div>
        ${SHAPES.map(
          (s) => html`<div class="sv-row"><span>${SIDES.map((side) => html`<span class=${`sv-mk s-${side}`} title=${`--${glyph(s, side)}`}>${read(glyph(s, side))}</span>`)}</span><span class="sv-n">${s}</span></div>`,
        )}
        <div class="sv-row">${VERDICTS.map((x) => html`<span><span class=${`sv-mk v-${x}`} title=${`--${verdictGlyph(x)}`}>${read(verdictGlyph(x))}</span><span class="sv-n">${x}</span></span>`)}</div>
        <div class="sv-group">type</div>
        ${TYPE.map((n) => html`<div class="sv-row"><span style=${`font-size:var(--${n})`}>An island of items</span><span class="sv-n">${n} · ${read(n)}</span></div>`)}
        <div class="sv-group">space</div>
        <div class="sv-row">${SPACE.map((n) => html`<span><span class="sv-gap" style=${`width:var(--${n})`}></span><span class="sv-n">${n}</span></span>`)}</div>
        <div class="sv-group">controls</div>
        <div class="sv-row"><button class="sv-ctl">inside</button><button class="sv-ctl">around</button></div>
      </div>
    `;

    const View = () => {
      const [, restyle] = useState(0);
      useEffect(() => onStyle(() => restyle((n) => n + 1)), []);
      return html`<div class="sv"><${Half} scheme="light" /><${Half} scheme="dark" /></div>`;
    };

    ctx.effect(() => {
      const el = document.createElement("style");
      el.textContent = STYLE;
      document.head.append(el);
      return () => el.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "shell.main", name: "view", title: "Style", view: View });
  },
};

export default styleView;
