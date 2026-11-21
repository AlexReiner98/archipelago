/**
 * Example: a frame of your own. The six regions in one column, top to
 * bottom, every fill of each shown. Every pack's fills land in it
 * unchanged, because they name regions, not places on a page.
 *
 * Swap it in: page.set { pack: "frame", on: false }, then
 * page.set { pack: "column", on: true }. Undo both to go back.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { SlotFill, SlotRead } from "../../spec/slot.ts";
import { REGIONS } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { sheet } from "../../spec/style.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

const STYLE = sheet(`
html, body { margin:0; height:100%; background:var(--bg); color:var(--fg); font:var(--text)/var(--leading) var(--font); }
.col { max-width:720px; margin:0 auto; display:flex; flex-direction:column; gap:var(--space-5); padding:var(--space-5); }
.col-region > * { display:block; min-height:0; }
.col-center > * { height:70vh; border:1px solid var(--line); border-radius:var(--radius); overflow:hidden; }
`);

const column: Pack = {
  id: "column",
  about: "An example to copy: a page layout of your own.",
  inject: ["slot.fill", "slot.read"],
  apply(ctx: Context) {
    const read = ctx.get<SlotRead>("slot.read");

    const Column = () => {
      const [, tick] = useState(0);
      useEffect(() => {
        const stops = REGIONS.map((r) => read.watch(r, () => tick((x) => x + 1)));
        return () => void stops.forEach((s) => s());
      }, []);
      return html`<div class="col">
        ${REGIONS.filter((r) => read.fills(r).length).map((r) => html`<div key=${r} class=${`col-region col-${r}`}><${read.Slot} name=${r} /></div>`)}
      </div>`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "root", name: "column", view: Column });
  },
};

export default column;
