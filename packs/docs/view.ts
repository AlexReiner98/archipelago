/**
 * The docs pack, page side: the Packs view, read only. Like other apps'
 * plugin lists: one card per loaded pack, each the line the pack declares
 * (`about`) and counts of what it adds, each count opening its list (a
 * view its tab, a kind of item the Map on it, what it says the Reflex
 * tree). Problems come first, and only when there are any; then the packs
 * built into this repository, then those added from elsewhere. No wiring:
 * keys and config stay in the reference, for agents (the `packs` tool).
 *
 * The server's packs come through `docs.read` (the bridge), the page's own
 * are read from the page's runtime the same way (read.ts).
 *
 * A card is composable: its title line is the slot `docs.card.head` and its
 * body the slot `docs.card`, both `many`, each fill given `{ pack, all }`
 * (a PackDoc, and every pack's). This pack fills the body; an on/off switch
 * goes in the head.
 *
 * It invokes no action. Opening the Map on a kind sets the page's query
 * (`find.query`, a `here` key), which is not one. Its styles go when it
 * unloads.
 */
import { h } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import htm from "htm";
import type { HereSet } from "../../spec/here.ts";
import type { SlotDeclare, SlotFill, SlotRead } from "../../spec/slot.ts";
import { sheet } from "../../spec/style.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { countsOf, listsOf, matches, merged, stateWords, troubled, type Count, type Named } from "./cards.ts";
import { digest, KEY, reference, type DocsRead, type PackDoc } from "./read.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const HEAD = "docs.card.head";
export const BODY = "docs.card";
/** The page's query, which the Map draws (the find pack's `here` key). */
const QUERY = "find.query";
/** This repository's root, as the page sees it: a pack loaded from under it is built in. */
const ROOT = new URL("../../", import.meta.url).href;

const SHEET = sheet(`
.dk { height:100%; overflow:auto; padding:var(--space-4) var(--space-4) var(--space-5); box-sizing:border-box; }
.dk-bar { display:flex; gap:var(--space-3); align-items:center; color:var(--dim); flex-wrap:wrap; }
.dk-bar input { font:inherit; padding:var(--space-1) var(--space-2); border:1px solid var(--control-line); border-radius:var(--radius); background:var(--control); color:var(--control-fg); min-width:240px; }
.dk-list { margin-top:var(--space-4); }
.dk-list > h3 { margin:0 0 var(--space-2); font-size:var(--text-s); font-weight:var(--bold); color:var(--dim); }
.dk-list.trouble > h3 { color:var(--failed); }
.dk-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:var(--space-2); align-items:start; }
.dk-card { border:1px solid var(--line); border-radius:var(--radius); background:var(--panel); padding:var(--space-2) var(--space-3); min-width:0; }
.dk-card.trouble { border-color:var(--failed); }
.dk-head { display:flex; align-items:center; gap:var(--space-2); }
.dk-head b { font-weight:var(--bold); }
.dk-head .dk-sp { flex:1; }
.dk-about { margin-top:2px; color:var(--fg); }
.dk-about.none { color:var(--quiet); font-style:italic; }
.dk-warn { color:var(--failed); margin-top:2px; }
.dk-dim { color:var(--dim); margin-top:2px; font-size:var(--text-s); }
.dk-counts { display:flex; flex-wrap:wrap; gap:2px var(--space-3); margin-top:var(--space-1); font-size:var(--text-s); }
.dk-counts a, .dk-counts button, .dk-open a { color:var(--pick); text-decoration:none; background:none; border:0; padding:0; font:inherit; cursor:pointer; }
.dk-counts a:hover, .dk-counts button:hover, .dk-open a:hover { text-decoration:underline; }
.dk-counts button.on { color:var(--fg); }
.dk-open { margin:var(--space-1) 0 0; padding-left:var(--space-4); font-size:var(--text-s); }
`);

const view: Pack = {
  id: "docs",
  about: "Shows every running pack: what it is for and what it adds.",
  inject: [KEY, "slot.declare", "slot.fill", "slot.read", "here.set"],
  apply(ctx: Context) {
    const server = ctx.get<DocsRead>(KEY);
    const slots = ctx.get<SlotRead>("slot.read");
    const declare = ctx.get<SlotDeclare>("slot.declare");
    const fill = ctx.get<SlotFill>("slot.fill");
    const here = ctx.get<HereSet>("here.set");

    /** A thing a card names, as a link to where it opens. */
    const Link = ({ to }: { to: Named }) => {
      if (to.view) return html`<a href=${`#${to.view}`}>${to.title}</a>`;
      if (to.query) {
        const open = () => {
          try {
            here.set(QUERY, to.query);
          } catch {
            // No Map on this page to draw it: the tab still opens.
          }
        };
        return html`<a href="#map" onClick=${open} title=${`The Map on ${to.query}`}>${to.title}</a>`;
      }
      return html`<span>${to.title}</span>`;
    };

    /** What it is for, and its state when it isn't simply running. */
    const About = ({ pack }: { pack: PackDoc }) => html`
      <div class=${`dk-about${pack.about ? "" : " none"}`}>${pack.about ?? "It doesn't say what it is for."}</div>
      ${stateWords(pack) && html`<div class=${troubled(pack) ? "dk-warn" : "dk-dim"}>${stateWords(pack)}</div>`}
    `;

    /** What it adds, as counts; a count opens its list, or its view. */
    const Counts = ({ pack, all }: { pack: PackDoc; all: PackDoc[] }) => {
      const counts = countsOf(pack, all);
      const [open, setOpen] = useState<string | undefined>(undefined);
      if (!counts.length) return null;
      const shown = counts.find((c) => c.key === open);
      const one = (c: Count) =>
        c.view
          ? html`<a key=${c.key} href=${`#${c.view}`}>${c.label}</a>`
          : html`<button key=${c.key} class=${open === c.key ? "on" : ""} onClick=${() => setOpen(open === c.key ? undefined : c.key)}>${c.label}</button>`;
      return html`
        <div class="dk-counts">${counts.map(one)}</div>
        ${shown?.items && html`<ul class="dk-open">${shown.items.map((i, k) => html`<li key=${k}><${Link} to=${i} /></li>`)}</ul>`}
      `;
    };

    declare.declare({ name: HEAD, merge: "many", doc: "A pack's card, its title line: each fill gets { pack, all }." });
    declare.declare({ name: BODY, merge: "many", doc: "A pack's card, its body: each fill gets { pack, all }." });
    fill.fill({ slot: BODY, name: "about", view: About as any });
    fill.fill({ slot: BODY, name: "counts", view: Counts as any });

    const Fills = ({ name, pack, all }: { name: string; pack: PackDoc; all: PackDoc[] }) => {
      const [, tick] = useState(0);
      useEffect(() => slots.watch(name, () => tick((x) => x + 1)) as () => void, [name]);
      return html`${slots.fills(name).map((f) => html`<${f.view} key=${`${f.pack}/${f.name}`} pack=${pack} all=${all} />`)}`;
    };

    /** One pack: its name and what fills the head, then what fills the body. */
    const Card = ({ pack, all }: { pack: PackDoc; all: PackDoc[] }) => html`
      <div class=${`dk-card${troubled(pack) ? " trouble" : ""}`} data-pack=${pack.id}>
        <div class="dk-head">
          <b>${pack.id}</b>
          <span class="dk-sp"></span>
          <${Fills} name=${HEAD} pack=${pack} all=${all} />
        </div>
        <${Fills} name=${BODY} pack=${pack} all=${all} />
      </div>
    `;

    const usePacks = () => {
      const [docs, setDocs] = useState<PackDoc[]>([]);
      useEffect(() => {
        let live = true;
        const read = async () => {
          const remote = await server.packs().catch(() => [] as PackDoc[]);
          if (live) setDocs(merged(remote, reference(ctx.runtime, { side: "page", root: ROOT, slots })));
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
      const lists = useMemo(() => listsOf(docs.filter((d) => matches(d, q))), [docs, q]);
      return html`
        <div class="dk">
          <div class="dk-bar">
            <input placeholder="filter: a pack, or what it does" value=${q} onInput=${(e: any) => setQ(e.currentTarget.value)} />
            <span>${docs.length} packs running. Each says what it is for; what it adds is read from it as it runs.</span>
          </div>
          ${lists.map(
            (l) => html`<section key=${l.key} class=${`dk-list ${l.key}`}>
              <h3>${l.title}</h3>
              <div class="dk-grid">${l.docs.map((d) => html`<${Card} key=${d.id} pack=${d} all=${docs} />`)}</div>
            </section>`,
          )}
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
