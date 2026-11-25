/**
 * Example: a panel of your own. What is being worked on now, in the region
 * `left`. A click opens the item on the map. Copy this file to start one.
 *
 * Turn it on: page.set { plugin: "today", on: true }
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { sheet } from "../../spec/style.ts";
import type { FindIndex } from "../find/index.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

const STYLE = sheet(`
.td-row { padding:1px var(--space-4); cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.td-row:hover { color:var(--pick); }
`);

const today: Plugin = {
  id: "today",
  about: "An example to copy: a panel of what is being worked on now.",
  inject: ["find.index", "here.set", "slot.fill"],
  apply(ctx: Context) {
    const index = ctx.get<FindIndex>("find.index");
    const set = ctx.get<HereSet>("here.set");

    const Today = () => {
      const [, tick] = useState(0);
      useEffect(() => index.watch(() => tick((x) => x + 1)) as () => void, []);
      return html`<div>${index.run("status:doing", 30).items.map(
        (r) => html`<div class="td-row" key=${r.id} onClick=${() => (set.set(KEYS.view, "field/field"), set.set(KEYS.item, r.id))}>${String(r.fields.title ?? r.id)}</div>`,
      )}</div>`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "left", name: "today", title: "Today", view: Today });
  },
};

export default today;
