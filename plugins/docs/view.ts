/**
 * The docs plugin, page side: the Plugins view, read only. Like other apps'
 * plugin lists: one card per plugin as a person sees it (the plugins in one
 * folder are one), each the line the plugin declares (`about`) and counts of
 * what it adds, live where they can be (items of each kind on the map, what
 * it did in the newest run), each opening its list. Problems come first,
 * and only when there are any; then the features, then the foundation (the
 * plugins that provide the spec's interfaces). A plugin's name opens its own
 * page (page.ts), where the wiring is too, folded.
 *
 * The server's plugins come through `docs.read` (the bridge), the page's own
 * are read from the page's runtime the same way (read.ts).
 *
 * Composable: a card's title line is the slot `docs.card.head`, its body
 * `docs.card`, a plugin's page `docs.page`, all `many`, each fill given
 * `{ plugin, all }`. This plugin fills the body and the page; an on/off switch
 * goes in the head.
 *
 * It invokes no action. What it opens it opens through `here` keys
 * (`find.query` for the Map, `here.run` for the context interface, `docs.plugin` for a
 * plugin's page), which are not actions. Its styles go when it unloads.
 */
import { h } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import htm from "htm";
import type { HereDeclare, HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { LoaderTree } from "../../spec/loader.ts";
import type { SlotDeclare, SlotFill, SlotRead } from "../../spec/slot.ts";
import { sheet } from "../../spec/style.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { byFolder, countsOf, listsOf, matches, stateWords, troubled, type Count, type Named } from "./cards.ts";
import { sections } from "./page.ts";
import { digest, KEY, reference, type DocsRead, type PluginDoc } from "./read.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const HEAD = "docs.card.head";
export const BODY = "docs.card";
export const PAGE = "docs.page";
/** The plugin whose page is open. */
export const OPEN = "docs.plugin";
/** The page's query, which the Map draws (the find plugin's `here` key). */
const QUERY = "find.query";
/** This repository's root, as the page sees it: a plugin loaded from under it is built in. */
const ROOT = new URL("../../", import.meta.url).href;

const SHEET = sheet(`
.dk { height:100%; overflow:auto; padding:var(--space-4) var(--space-4) var(--space-5); box-sizing:border-box; }
.dk-bar { display:flex; gap:var(--space-3); align-items:center; color:var(--dim); flex-wrap:wrap; }
.dk-bar input { font:inherit; padding:var(--space-1) var(--space-2); border:1px solid var(--control-line); border-radius:var(--radius); background:var(--control); color:var(--control-fg); min-width:240px; }
.dk-list { margin-top:var(--space-4); }
.dk-list > h3 { margin:0 0 var(--space-2); font-size:var(--text-s); font-weight:var(--bold); }
.dk-list > h3 span { color:var(--dim); font-weight:normal; margin-left:var(--space-2); }
.dk-list.trouble > h3 { color:var(--failed); }
.dk-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(260px, 1fr)); gap:var(--space-2); align-items:start; }
.dk-card { border:1px solid var(--line); border-radius:var(--radius); background:var(--panel); padding:var(--space-2) var(--space-3); min-width:0; }
.dk-card.trouble { border-color:var(--failed); }
.dk-head { display:flex; align-items:center; gap:var(--space-2); }
.dk-head .dk-sp { flex:1; }
.dk-name { font-weight:var(--bold); color:var(--fg); text-decoration:none; }
.dk-name:hover { text-decoration:underline; }
.dk-tag { font-size:var(--text-xs); color:var(--dim); border:1px solid var(--line); border-radius:var(--radius); padding:0 var(--space-1); }
.dk-about { margin-top:2px; color:var(--fg); }
.dk-about.none, .dk-lead.none { color:var(--quiet); font-style:italic; }
.dk-warn { color:var(--failed); margin-top:2px; }
.dk-dim { color:var(--dim); }
.dk-counts { display:flex; flex-wrap:wrap; gap:2px var(--space-3); margin-top:var(--space-1); font-size:var(--text-s); }
.dk a, .dk-counts button { color:var(--pick); text-decoration:none; background:none; border:0; padding:0; font:inherit; cursor:pointer; }
.dk a:hover, .dk-counts button:hover { text-decoration:underline; }
.dk-counts button.on { color:var(--fg); }
.dk-open { margin:var(--space-1) 0 0; padding-left:var(--space-4); font-size:var(--text-s); }
.dk-page { max-width:760px; }
.dk-page h2 { margin:var(--space-2) 0 0; font-size:var(--text-l); }
.dk-lead { font-size:var(--text-m); margin:var(--space-1) 0 var(--space-3); }
.dk-sec { margin-top:var(--space-4); }
.dk-sec h4 { display:inline; margin:0; font-size:var(--text-s); color:var(--dim); font-weight:var(--bold); }
.dk-sec > h4 { display:block; margin-bottom:var(--space-1); }
.dk-sec p { margin:var(--space-1) 0; }
.dk-sec summary { cursor:pointer; }
.dk-act { margin:var(--space-2) 0; }
.dk-table { border-collapse:collapse; }
.dk-table td { padding:2px var(--space-3) 2px 0; vertical-align:top; }
.dk-table td.num { text-align:right; font-variant-numeric:tabular-nums; }
.dk-page code, .dk-page pre { font-family:var(--mono); font-size:var(--text-s); }
.dk-page pre { white-space:pre-wrap; word-break:break-all; color:var(--dim); }
`);

const view: Plugin = {
  id: "docs",
  about: "Shows every running plugin: what it is for and what it adds.",
  inject: [KEY, "slot.declare", "slot.fill", "slot.read", "here.declare", "here.read", "here.set", "loader.tree"],
  apply(ctx: Context) {
    const server = ctx.get<DocsRead>(KEY);
    // Read only: each entry's id and state, so a card knows what turns it on and off.
    const loader = ctx.get<LoaderTree>("loader.tree");
    const slots = ctx.get<SlotRead>("slot.read");
    const declare = ctx.get<SlotDeclare>("slot.declare");
    const fill = ctx.get<SlotFill>("slot.fill");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    ctx.get<HereDeclare>("here.declare").declare({ key: OPEN, scope: "page", doc: "The plugin whose page the Plugins view shows." });

    /** Sets a `here` key; a key nobody declared (its plugin isn't loaded) is let go. */
    const put = (key: string, value: string | undefined) => {
      try {
        set.set(key, value);
      } catch {
        // Nothing to show it on this page: the tab still opens.
      }
    };

    /** A thing the view names, as a link to where it opens. */
    const Link = ({ to }: { to: Named }) => {
      if (to.plugin) return html`<a href="#docs" onClick=${() => put(OPEN, to.plugin)}>${to.title}</a>`;
      if (to.run) return html`<a href="#harness" onClick=${() => put(KEYS.run, to.run)}>${to.title}</a>`;
      if (to.query) return html`<a href="#map" onClick=${() => put(QUERY, to.query)} title=${`The Map on ${to.query}`}>${to.title}</a>`;
      if (to.view) return html`<a href=${`#${to.view}`}>${to.title}</a>`;
      return html`<span>${to.title}</span>`;
    };

    /** What it is for, and its state when it isn't simply running. */
    const About = ({ plugin }: { plugin: PluginDoc }) => html`
      <div class=${`dk-about${plugin.about ? "" : " none"}`}>${plugin.about ?? "It doesn't say what it is for."}</div>
      ${stateWords(plugin) && html`<div class=${troubled(plugin) ? "dk-warn" : "dk-dim"}>${stateWords(plugin)}</div>`}
    `;

    /** What it adds, as counts; a count opens its list, or goes where it points. */
    const Counts = ({ plugin, all }: { plugin: PluginDoc; all: PluginDoc[] }) => {
      const counts = countsOf(plugin, all);
      const [open, setOpen] = useState<string | undefined>(undefined);
      if (!counts.length) return null;
      const shown = counts.find((c) => c.key === open);
      const one = (c: Count) =>
        c.to
          ? html`<${Link} key=${c.key} to=${{ ...c.to, title: c.label }} />`
          : html`<button key=${c.key} class=${open === c.key ? "on" : ""} onClick=${() => setOpen(open === c.key ? undefined : c.key)}>${c.label}</button>`;
      return html`
        <div class="dk-counts">${counts.map(one)}</div>
        ${shown?.items && html`<ul class="dk-open">${shown.items.map((i, k) => html`<li key=${k}><${Link} to=${i} /></li>`)}</ul>`}
      `;
    };

    declare.declare({ name: HEAD, merge: "many", doc: "A plugin's card, its title line: each fill gets { plugin, all }." });
    declare.declare({ name: BODY, merge: "many", doc: "A plugin's card, its body: each fill gets { plugin, all }." });
    declare.declare({ name: PAGE, merge: "many", doc: "A plugin's own page, section by section: each fill gets { plugin, all }." });
    fill.fill({ slot: BODY, name: "about", view: About as any });
    fill.fill({ slot: BODY, name: "counts", view: Counts as any });
    for (const [name, v] of sections(Link)) fill.fill({ slot: PAGE, name, view: v as any });

    const Fills = ({ name, plugin, all }: { name: string; plugin: PluginDoc; all: PluginDoc[] }) => {
      const [, tick] = useState(0);
      useEffect(() => slots.watch(name, () => tick((x) => x + 1)) as () => void, [name]);
      return html`${slots.fills(name).map((f) => html`<${f.view} key=${`${f.plugin}/${f.name}`} plugin=${plugin} all=${all} />`)}`;
    };

    /** One plugin: its name (opening its page) and what fills the head, then what fills the body. */
    const Card = ({ plugin, all }: { plugin: PluginDoc; all: PluginDoc[] }) => html`
      <div class=${`dk-card${troubled(plugin) ? " trouble" : ""}`} data-plugin=${plugin.id}>
        <div class="dk-head">
          <a class="dk-name" href="#docs" onClick=${() => put(OPEN, plugin.id)}>${plugin.id}</a>
          ${plugin.builtIn === false && html`<span class="dk-tag" title="Added from outside this repository">added</span>`}
          <span class="dk-sp"></span>
          <${Fills} name=${HEAD} plugin=${plugin} all=${all} />
        </div>
        <${Fills} name=${BODY} plugin=${plugin} all=${all} />
      </div>
    `;

    /** One plugin's page. */
    const Page = ({ plugin, all }: { plugin: PluginDoc; all: PluginDoc[] }) => html`
      <div class="dk-page">
        <a href="#docs" onClick=${() => put(OPEN, undefined)}>All plugins</a>
        <h2>${plugin.id}</h2>
        <${Fills} name=${PAGE} plugin=${plugin} all=${all} />
      </div>
    `;

    const usePlugins = () => {
      const [docs, setDocs] = useState<PluginDoc[]>([]);
      useEffect(() => {
        let live = true;
        const read = async () => {
          const remote = await server.plugins().catch(() => [] as PluginDoc[]);
          if (live) setDocs(byFolder([...remote, ...reference(ctx.runtime, { side: "page", root: ROOT, slots, entries: loader.status() })]));
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

    const useOpen = () => {
      const [v, setV] = useState<string | undefined>(here.get<string>(OPEN));
      useEffect(() => here.watch(OPEN, (c) => setV(typeof c.value === "string" ? c.value : undefined)) as () => void, []);
      return v;
    };

    const View = () => {
      const docs = usePlugins();
      const opened = useOpen();
      const [q, setQ] = useState("");
      const lists = useMemo(() => listsOf(docs.filter((d) => matches(d, q))), [docs, q]);
      const page = opened && docs.find((d) => d.id === opened);
      if (page) return html`<div class="dk"><${Page} plugin=${page} all=${docs} /></div>`;
      return html`
        <div class="dk">
          <div class="dk-bar">
            <input placeholder="filter: a plugin, or what it does" value=${q} onInput=${(e: any) => setQ(e.currentTarget.value)} />
            <span>${docs.length} plugins running. Each says what it is for; what it adds is read from it as it runs.</span>
          </div>
          ${lists.map(
            (l) => html`<section key=${l.key} class=${`dk-list ${l.key}`}>
              <h3>${l.title}<span>${l.doc}</span></h3>
              <div class="dk-grid">${l.docs.map((d) => html`<${Card} key=${d.id} plugin=${d} all=${docs} />`)}</div>
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
    fill.fill({ slot: "center", name: "view", title: "Plugins", view: View });
  },
};

export default view;
