/**
 * The docs pack, page side: the Packs view, one card per loaded pack, read
 * only. A card says what the pack is for and what it adds, in plain words:
 * what you can do with it, the kinds of item it defines, the views it puts
 * on the page, how much it says to agents. No wiring: the keys and config
 * stay in the reference, for agents (the `packs` tool). Packs with a
 * problem come first.
 *
 * The server's packs come through `docs.read` (the bridge), the page's own
 * are read from the page's runtime the same way (read.ts).
 *
 * A card is composable: its title line is the slot `docs.card.head` and its
 * body the slot `docs.card`, both `many`, each fill given `{ pack }` (a
 * PackDoc). This pack fills the body; an on/off switch goes in the head.
 *
 * It invokes no action. Its styles go when it unloads.
 */
import { h } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import htm from "htm";
import type { SlotDeclare, SlotFill, SlotRead } from "../../spec/slot.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { addsOf, matches, merged, ordered, stateWords, troubled } from "./cards.ts";
import { digest, KEY, reference, type DocsRead, type PackDoc } from "./read.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const HEAD = "docs.card.head";
export const BODY = "docs.card";

const SHEET = `
.dk { height:100%; overflow:auto; padding:14px 16px 40px; box-sizing:border-box; }
.dk-bar { display:flex; gap:12px; align-items:center; margin-bottom:14px; color:var(--dim); flex-wrap:wrap; }
.dk-bar input { font:inherit; padding:4px 8px; border:1px solid var(--line); border-radius:4px; background:var(--panel); color:var(--fg); min-width:240px; }
.dk-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:12px; align-items:start; }
.dk-card { border:1px solid var(--line); border-radius:6px; background:var(--panel); padding:10px 12px; min-width:0; overflow:hidden; }
.dk-card.trouble { border-color:var(--failed); }
.dk-head { display:flex; align-items:center; gap:8px; }
.dk-head b { font-size:14px; }
.dk-head .dk-sp { flex:1; }
.dk-dot { width:8px; height:8px; border-radius:50%; display:inline-block; background:var(--quiet); }
.dk-dot.active { background:var(--held); }
.dk-dot.failed, .dk-dot.waiting { background:var(--failed); }
.dk-about { margin:4px 0 2px; }
.dk-about.none { color:var(--quiet); font-style:italic; }
.dk-warn { color:var(--failed); margin:4px 0; }
.dk-row { margin-top:6px; color:var(--dim); font-size:12px; }
.dk-row b { color:var(--fg); font-weight:500; }
.dk-list { margin:2px 0 0; padding-left:16px; color:var(--fg); }
.dk-more { color:var(--dim); cursor:pointer; }
`;

const SHOWN = 4;

/** A few of a list, then "n more" to open the rest. */
const List = ({ items }: { items: string[] }) => {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, SHOWN);
  return html`<ul class="dk-list">
    ${shown.map((x, i) => html`<li key=${i}>${x}</li>`)}
    ${items.length > SHOWN && html`<li class="dk-more" onClick=${() => setAll(!all)}>${all ? "fewer" : `${items.length - SHOWN} more`}</li>`}
  </ul>`;
};

const About = ({ pack }: { pack: PackDoc }) => html`
  <div class=${`dk-about${pack.about ? "" : " none"}`}>${pack.about ?? "Its README doesn't say what it is for yet."}</div>
  ${stateWords(pack) && html`<div class=${troubled(pack) ? "dk-warn" : "dk-row"}>${stateWords(pack)}</div>`}
`;

const Adds = ({ pack }: { pack: PackDoc }) => {
  const a = addsOf(pack);
  const n = (x: number, one: string, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;
  return html`
    ${a.views.length > 0 && html`<div class="dk-row"><b>Views</b> ${a.views.join(", ")}</div>`}
    ${a.parts.length > 0 && html`<div class="dk-row"><b>Adds to views</b> ${a.parts.join(", ")}</div>`}
    ${a.kinds.length > 0 && html`<div class="dk-row"><b>Kinds of item</b><${List} items=${a.kinds} /></div>`}
    ${a.actions.length > 0 && html`<div class="dk-row"><b>Lets you</b><${List} items=${a.actions} /></div>`}
    ${a.says > 0 && html`<div class="dk-row"><b>Says</b> ${n(a.says, "thing")} to agents</div>`}
  `;
};

const view: Pack = {
  id: "docs",
  inject: [KEY, "slot.declare", "slot.fill", "slot.read"],
  apply(ctx: Context) {
    const server = ctx.get<DocsRead>(KEY);
    const slots = ctx.get<SlotRead>("slot.read");
    const declare = ctx.get<SlotDeclare>("slot.declare");
    const fill = ctx.get<SlotFill>("slot.fill");
    declare.declare({ name: HEAD, merge: "many", doc: "A pack's card, its title line: each fill gets { pack }." });
    declare.declare({ name: BODY, merge: "many", doc: "A pack's card, its body: each fill gets { pack }." });
    fill.fill({ slot: BODY, name: "about", view: About as any });
    fill.fill({ slot: BODY, name: "adds", view: Adds as any });

    const Fills = ({ name, pack }: { name: string; pack: PackDoc }) => {
      const [, tick] = useState(0);
      useEffect(() => slots.watch(name, () => tick((x) => x + 1)) as () => void, [name]);
      return html`${slots.fills(name).map((f) => html`<${f.view} key=${`${f.pack}/${f.name}`} pack=${pack} />`)}`;
    };

    /** One pack: its title line, then whatever fills the card. */
    const Card = ({ pack }: { pack: PackDoc }) => html`
      <div class=${`dk-card${troubled(pack) ? " trouble" : ""}`} data-pack=${pack.id}>
        <div class="dk-head">
          <span class=${`dk-dot ${pack.state}`} title=${pack.state}></span>
          <b>${pack.id}</b>
          <span class="dk-sp"></span>
          <${Fills} name=${HEAD} pack=${pack} />
        </div>
        <${Fills} name=${BODY} pack=${pack} />
      </div>
    `;

    const usePacks = () => {
      const [docs, setDocs] = useState<PackDoc[]>([]);
      useEffect(() => {
        let live = true;
        let about: Record<string, string> | undefined;
        const read = async () => {
          const remote = await server.packs().catch(() => [] as PackDoc[]);
          const ids = [...ctx.runtime.fibers].map((f) => f.pack.id);
          about ??= await server.about(ids).catch(() => ({}));
          if (live) setDocs(merged(remote, reference(ctx.runtime, { side: "page", slots, about })));
        };
        void read();
        const stop = server.watch(() => void read());
        let last = digest(ctx.runtime);
        const timer = setInterval(() => {
          const now = digest(ctx.runtime);
          if (now !== last) (last = now), void read();
        }, 1000);
        return () => {
          live = false;
          clearInterval(timer);
          void stop();
        };
      }, []);
      return docs;
    };

    const View = () => {
      const docs = usePacks();
      const [q, setQ] = useState("");
      const shown = useMemo(() => ordered(docs.filter((d) => matches(d, q))), [docs, q]);
      const trouble = docs.filter(troubled).length;
      return html`
        <div class="dk">
          <div class="dk-bar">
            <input placeholder="filter: a pack, or what it does" value=${q} onInput=${(e: any) => setQ(e.currentTarget.value)} />
            <span>${docs.length} packs running${trouble ? `, ${trouble} with a problem` : ""}. Everything here is read from the packs themselves.</span>
          </div>
          <div class="dk-grid">${shown.map((d) => html`<${Card} key=${d.id} pack=${d} />`)}</div>
        </div>
      `;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = SHEET;
      document.head.append(style);
      return () => style.remove();
    });
    fill.fill({ slot: "shell.main", name: "view", title: "Packs", view: View });
  },
};

export default view;
