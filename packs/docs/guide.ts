/**
 * The Guide, page side: the docs a new person reads, drawn from the
 * repository's own Markdown as the running server holds it
 * (`docs.read.guide()` and `docs.read.chapter(path)`, files.ts). Never
 * typed apart from the files.
 *
 * - **Contents** on the left, one line each: the path in its order (from
 *   `guide/README.md`), the spec's contracts, then every pack's README.
 *   Narrow, it is one picker.
 * - **A chapter**: its lead open, then each `##` section folded to its
 *   first lines; a click opens it. A link to another chapter opens it here,
 *   at its heading; a link out of the repository opens a tab.
 * - **Linked with Packs, both ways:** a pack's README opens its page in
 *   the Packs view (`docs.pack`), and a pack's page there gets a section
 *   that opens its README here (a fill of `docs.page`).
 *
 * What it shows is `guide.open` (a `here` key): a chapter's path, with
 * `#anchor` for a heading in it. It reads only, invokes no action, and its
 * styles go when it unloads.
 */
import { h } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import htm from "htm";
import type { HereDeclare, HereRead, HereSet } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import { sheet } from "../../spec/style.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { chapter, external, plain, resolve, type Section } from "./markdown.ts";
import { Blocks, Text, type LinkView } from "./prose.ts";
import { KEY, type DocsRead, type GuideEntry, type PackDoc } from "./read.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** The chapter open, and the heading in it: `path#anchor`. */
export const GUIDE = "guide.open";
/** The Packs view's own key: the pack whose page is open (view.ts). */
const PACK = "docs.pack";

/** A link's target as a chapter of the guide, or undefined when it isn't one. */
export function target(entries: GuideEntry[], from: string, href: string): { path: string; anchor?: string } | undefined {
  const to = resolve(from, href);
  if (!to) return undefined;
  const path = to.path === "" || to.path.endsWith("/") ? `${to.path}README.md` : to.path;
  const hit = entries.find((e) => e.path === path) ?? entries.find((e) => e.path === `${path}/README.md`);
  return hit ? { path: hit.path, ...(to.anchor ? { anchor: to.anchor } : {}) } : undefined;
}

/** The section an anchor is in: its own `##` heading, or a deeper heading inside it. */
export function sectionOf(sections: Section[], anchor: string | undefined): number {
  if (!anchor) return -1;
  return sections.findIndex((s) => s.head?.id === anchor || s.blocks.some((b) => b.t === "h" && b.id === anchor));
}

/** A section that fits in its fold (one short paragraph) starts open: folding it would hide nothing. */
export function short(section: Section): boolean {
  const [b, ...rest] = section.blocks;
  return !rest.length && b?.t === "p" && plain(b.text).length <= 280;
}

const SHEET = sheet(`
.gd { height:100%; display:grid; grid-template-columns:minmax(160px, 220px) minmax(0, 1fr); box-sizing:border-box; }
.gd-nav { overflow:auto; border-right:1px solid var(--line); padding:var(--space-3) 0 var(--space-5); }
.gd-nav h3 { margin:var(--space-3) var(--space-3) var(--space-1); font-size:var(--text-xs); color:var(--dim); font-weight:var(--bold); }
.gd-nav a { display:block; padding:1px var(--space-3); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:var(--fg); text-decoration:none; }
.gd-nav a:hover { color:var(--pick); }
.gd-nav a.on { color:var(--pick); font-weight:var(--bold); }
.gd-pick { display:none; }
.gd-main { overflow:auto; padding:var(--space-4) var(--space-4) var(--space-5); min-width:0; }
.gd-doc { max-width:760px; }
.gd-doc h2 { margin:0; font-size:var(--text-l); }
.gd-meta { display:flex; gap:var(--space-3); color:var(--dim); font-size:var(--text-s); margin:var(--space-1) 0 var(--space-3); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.gd-doc a { color:var(--pick); text-decoration:none; cursor:pointer; }
.gd-doc a:hover { text-decoration:underline; }
.gd-doc p { margin:var(--space-1) 0; }
.gd-doc ul, .gd-doc ol { margin:var(--space-1) 0; padding-left:var(--space-4); }
.gd-doc li > p { margin:0; }
.gd-doc code, .gd-doc pre { font-family:var(--mono); font-size:var(--text-s); }
.gd-doc pre { background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); padding:var(--space-2); overflow:auto; margin:var(--space-1) 0; }
.gd-doc blockquote { margin:var(--space-1) 0; padding-left:var(--space-3); border-left:2px solid var(--line); color:var(--dim); }
.gd-table { overflow:auto; margin:var(--space-1) 0; }
.gd-doc table { border-collapse:collapse; font-size:var(--text-s); }
.gd-doc th, .gd-doc td { text-align:left; vertical-align:top; padding:2px var(--space-3) 2px 0; border-bottom:1px solid var(--line); }
.gd-sub { margin:var(--space-2) 0 0; font-size:var(--text-s); }
.gd-sec { margin-top:var(--space-3); border-top:1px solid var(--line); padding-top:var(--space-2); }
.gd-sec > h3 { margin:0; font-size:var(--text-m); }
.gd-sec > h3 button { font:inherit; color:var(--fg); background:none; border:0; padding:0; cursor:pointer; text-align:left; }
.gd-sec > h3 button:hover { color:var(--pick); }
.gd-sec > h3 span { color:var(--dim); display:inline-block; width:1.2em; }
.gd-fold { max-height:4lh; overflow:hidden; cursor:pointer; color:var(--dim); -webkit-mask-image:linear-gradient(to bottom, var(--fg) 50%, transparent); mask-image:linear-gradient(to bottom, var(--fg) 50%, transparent); }
.gd-fold pre { overflow:hidden; }
.gd-next { margin-top:var(--space-4); display:flex; justify-content:space-between; gap:var(--space-3); white-space:nowrap; }
.gd-none { color:var(--quiet); font-style:italic; }
@media (max-width: 640px) {
  .gd { grid-template-columns:minmax(0, 1fr); grid-template-rows:auto minmax(0, 1fr); }
  .gd-nav { display:none; }
  .gd-pick { display:block; padding:var(--space-2) var(--space-4) 0; }
  .gd-pick select { font:inherit; width:100%; padding:var(--space-1) var(--space-2); border:1px solid var(--control-line); border-radius:var(--radius); background:var(--control); color:var(--control-fg); }
}
`);

const guidePack: Pack = {
  id: "guide",
  about: "The guide for new people: the repository's own docs, in order, then every pack's README.",
  inject: [KEY, "slot.fill", "here.declare", "here.read", "here.set"],
  apply(ctx: Context) {
    const server = ctx.get<DocsRead>(KEY);
    const fill = ctx.get<SlotFill>("slot.fill");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    ctx.get<HereDeclare>("here.declare").declare({ key: GUIDE, scope: "page", doc: "The Guide's open chapter, a path from the repository's root, with #anchor for a heading in it." });

    /** Sets a `here` key; one nobody declared (its pack isn't loaded) is let go. */
    const put = (key: string, value: string | undefined) => {
      try {
        set.set(key, value);
      } catch {
        // The tab still opens.
      }
    };
    const open = (path: string, anchor?: string) => put(GUIDE, anchor ? `${path}#${anchor}` : path);

    // The chapters, read once a page and again when the server's packs change.
    let entries: GuideEntry[] = [];
    const listeners = new Set<() => void>();
    const load = async () => {
      entries = await server.guide().catch(() => entries);
      for (const on of [...listeners]) on();
    };
    void load();
    ctx.effect(() => server.watch(() => void load()) as () => void);
    const useEntries = () => {
      const [, tick] = useState(0);
      useEffect(() => {
        const on = () => tick((x) => x + 1);
        listeners.add(on);
        return () => void listeners.delete(on);
      }, []);
      return entries;
    };

    const useOpen = () => {
      const [v, setV] = useState<string | undefined>(here.get<string>(GUIDE));
      useEffect(() => here.watch(GUIDE, (c) => setV(typeof c.value === "string" ? c.value : undefined)) as () => void, []);
      return v;
    };

    /** A link in a chapter: to another chapter here, out to a tab, or a file of the repository named. */
    const linker = (all: GuideEntry[], from: string): LinkView => ({ href, children }) => {
      if (external(href)) return html`<a href=${href} target="_blank" rel="noopener noreferrer">${children}</a>`;
      const to = target(all, from, href);
      if (to) return html`<a href="#guide" onClick=${() => open(to.path, to.anchor)}>${children}</a>`;
      return html`<span title=${resolve(from, href)?.path ?? href}>${children}</span>`;
    };

    /** A `##` section: folded to its first lines until opened. */
    const Fold = ({ section, Link, opened }: { section: Section; Link: LinkView; opened: boolean }) => {
      const [isOpen, setOpen] = useState(opened || short(section));
      useEffect(() => void (opened && setOpen(true)), [opened]);
      const head = section.head!;
      return html`<section class="gd-sec">
        <h3 id=${`gd-${head.id}`}><button onClick=${() => setOpen(!isOpen)}><span>${isOpen ? "▾" : "▸"}</span><${Text} text=${head.text} Link=${Link} /></button></h3>
        ${isOpen
          ? html`<${Blocks} blocks=${section.blocks} Link=${Link} />`
          : section.blocks.length > 0 && html`<div class="gd-fold" onClick=${() => setOpen(true)}><${Blocks} blocks=${section.blocks.slice(0, 2)} Link=${Link} /></div>`}
      </section>`;
    };

    const Chapter = ({ entry, all, anchor }: { entry: GuideEntry; all: GuideEntry[]; anchor?: string }) => {
      const [text, setText] = useState<string | undefined>(undefined);
      const [failed, setFailed] = useState(false);
      useEffect(() => {
        let live = true;
        setText(undefined), setFailed(false);
        server.chapter(entry.path).then((t) => live && setText(t), () => live && setFailed(true));
        return () => void (live = false);
      }, [entry.path]);
      const doc = useMemo(() => (text === undefined ? undefined : chapter(text)), [text]);
      const at = doc ? sectionOf(doc.sections, anchor) : -1;
      useEffect(() => {
        if (!doc) return;
        const el = anchor ? document.getElementById(`gd-${anchor}`) : undefined;
        if (el) el.scrollIntoView({ block: "start" });
        else document.querySelector(".gd-main")?.scrollTo(0, 0);
      }, [doc, anchor]);
      const Link = linker(all, entry.path);
      const path = all.filter((e) => e.part === entry.part);
      const k = path.findIndex((e) => e.path === entry.path);
      const prev = path[k - 1];
      const next = path[k + 1];
      return html`<div class="gd-doc">
        <h2>${doc?.title ?? entry.title}</h2>
        <div class="gd-meta">
          <span>${entry.path}</span>
          ${entry.pack && html`<a href="#docs" onClick=${() => put(PACK, entry.pack)} title="The pack as it runs, in the Packs view">Its page in Packs</a>`}
        </div>
        ${failed && html`<p class="gd-none">This chapter can't be read now.</p>`}
        ${doc?.sections.map((s, i) =>
          s.head ? html`<${Fold} key=${`${entry.path}#${s.head.id}`} section=${s} Link=${Link} opened=${i === at} />` : html`<${Blocks} key="lead" blocks=${s.blocks} Link=${Link} />`,
        )}
        <div class="gd-next">
          <span>${prev && html`<a href="#guide" onClick=${() => open(prev.path)}>← ${prev.title}</a>`}</span>
          <span>${next && html`<a href="#guide" onClick=${() => open(next.path)}>${next.title} →</a>`}</span>
        </div>
      </div>`;
    };

    const View = () => {
      const all = useEntries();
      const value = useOpen();
      const [path, anchor] = (value ?? "").split("#", 2) as [string, string | undefined];
      const entry = all.find((e) => e.path === path) ?? all[0];
      const row = (e: GuideEntry, label: string) =>
        html`<a key=${e.path} href="#guide" class=${e.path === entry?.path ? "on" : ""} title=${e.path} onClick=${() => open(e.path)}>${label}</a>`;
      const parts: [string, GuideEntry[]][] = [
        ["The path", all.filter((e) => e.part === "path")],
        ["The spec", all.filter((e) => e.part === "spec")],
        ["Packs", all.filter((e) => e.part === "pack")],
      ];
      const name = (e: GuideEntry, i: number) => (e.part === "path" ? `${i + 1}. ${e.title}` : e.part === "pack" ? (e.pack ?? e.title) : e.title);
      return html`<div class="gd">
        <nav class="gd-nav">
          ${parts.map(([title, es]) => es.length > 0 && html`<h3 key=${title}>${title}</h3>${es.map((e, i) => row(e, name(e, i)))}`)}
        </nav>
        <div class="gd-pick">
          <select value=${entry?.path} onChange=${(e: any) => open(e.currentTarget.value)}>
            ${parts.map(([title, es]) => html`<optgroup key=${title} label=${title}>${es.map((e, i) => html`<option key=${e.path} value=${e.path}>${name(e, i)}</option>`)}</optgroup>`)}
          </select>
        </div>
        <div class="gd-main">
          ${entry ? html`<${Chapter} entry=${entry} all=${all} anchor=${entry.path === path ? anchor : undefined} />` : html`<p class="gd-none">The guide can't be read now.</p>`}
        </div>
      </div>`;
    };

    /** On a pack's page in the Packs view: its README, here. */
    const Readme = ({ pack }: { pack: PackDoc }) => {
      const all = useEntries();
      const e = all.find((x) => x.part === "pack" && x.pack === pack.id);
      if (!e) return null;
      return html`<section class="dk-sec"><h4>Its README</h4><p><a href="#guide" onClick=${() => open(e.path)}>${e.path}</a>, in the Guide</p></section>`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = SHEET;
      document.head.append(style);
      return () => style.remove();
    });
    fill.fill({ slot: "docs.page", name: "readme", view: Readme as any });
    fill.fill({ slot: "center", name: "view", title: "Guide", view: View });
  },
};

export default guidePack;
