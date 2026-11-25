/**
 * The document plugin, page side: the view "Document", in the region
 * `center`. It reads a part of the map top to bottom as one page: each
 * section an item, with its note, and what is part of it nested beneath,
 * work as a checklist (outline.ts says what goes where).
 *
 * - The sections are the view's `document.sections` (ids, in order), else
 *   the roots of its query (`find.query`).
 * - A title opens its item (`here.item`), the same page as anywhere else.
 * - It only shows, live: the map changes, the document follows.
 * - Printed, it is the document alone.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { Id, Json } from "../../spec/common.ts";
import type { HereDeclare, HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { sheet } from "../../spec/style.ts";
import type { FindIndex } from "../find/index.ts";
import { mark } from "../map/marks.ts";
import { inline, parse, type Block, type Span } from "../item/note.ts";
import { outline, sections, workLine, type Node } from "./outline.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const QUERY = "find.query";
/** A view's sections, in order: item ids. */
export const SECTIONS = "document.sections";
/** The most items a query's roots are read from. */
const LIMIT = 1000;

const STYLE = sheet(`
.dc { height:100%; overflow:auto; }
.dc-page { max-width:46rem; margin:0 auto; padding:var(--gap-l, 24px) var(--gap-l, 24px) 80px; color:var(--fg); font:var(--text-m) var(--font); line-height:1.55; }
.dc-toc { display:flex; flex-wrap:wrap; gap:4px 14px; padding-bottom:10px; margin-bottom:18px; border-bottom:1px solid var(--line); }
.dc-toc a { color:var(--dim); cursor:pointer; white-space:nowrap; }
.dc-toc a:hover { color:var(--fg); }
.dc-sec { margin:0 0 10px; }
.dc-h { cursor:pointer; margin:1.1em 0 .3em; line-height:1.3; }
.dc-h:hover { color:var(--pick); }
h2.dc-h { font-size:1.45em; padding-top:.6em; border-top:1px solid var(--line); }
h3.dc-h { font-size:1.15em; }
h4.dc-h, h5.dc-h { font-size:1em; }
.dc-note { margin:0 0 .4em; }
.dc-note p { margin:.35em 0; }
.dc-note ul, .dc-note ol { margin:.3em 0; padding-left:1.4em; }
.dc-note table { border-collapse:collapse; margin:.5em 0; }
.dc-note th, .dc-note td { border:1px solid var(--line); padding:3px 8px; text-align:left; vertical-align:top; }
.dc-note blockquote { margin:.4em 0; padding-left:10px; border-left:3px solid var(--line); color:var(--dim); }
.dc-note .sub { font-weight:600; margin:.6em 0 .2em; }
.dc-work { list-style:none; padding-left:0; margin:.2em 0 .5em; }
.dc-work li { margin:.15em 0; }
.dc-work .mk { display:inline-block; width:1.3em; }
.dc-work .t { cursor:pointer; }
.dc-work .t:hover { color:var(--pick); }
.dc-work .done { color:var(--dim); text-decoration:line-through; }
.dc-work .dc-note { margin-left:1.3em; color:var(--dim); }
.dc-work .dc-work { margin-left:1.3em; }
.dc-empty { color:var(--dim); padding:40px 0; text-align:center; }
@media print {
  body * { visibility:hidden; }
  .dc-page, .dc-page * { visibility:visible; }
  .dc-page { position:absolute; left:0; top:0; max-width:none; color:#000; }
  .dc-toc { display:none; }
  .dc-h { break-after:avoid; }
}
`);

const document_: Plugin = {
  id: "document",
  about: "The Document view: a part of the map read top to bottom as one page, its parts nested and its work as a checklist.",
  inject: ["find.index", "here.declare", "here.read", "here.set", "slot.fill"],
  apply(ctx: Context) {
    const index = ctx.get<FindIndex>("find.index");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    ctx.get<HereDeclare>("here.declare").declare({ key: SECTIONS, scope: "page", doc: "The sections the Document view reads, in order: item ids." });

    const useHere = <T extends Json>(key: string): T | undefined => {
      const [v, setV] = useState<T | undefined>(here.get<T>(key));
      useEffect(() => here.watch(key, (c) => setV(c.value as T | undefined)) as () => void, [key]);
      return v;
    };
    const useIndex = () => {
      const [, tick] = useState(0);
      useEffect(() => index.watch(() => tick((x) => x + 1)) as () => void, []);
      return index;
    };

    const open = (id: Id) => set.set(KEYS.item, id);
    const base = (type: string) => index.type(type)?.base ?? type;
    const isWork = (n: Node) => base(n.row.type) === "work";
    const title = (id: Id) => {
      const r = index.item(id);
      return r ? String(r.fields.title ?? id) : undefined;
    };

    const Spans = ({ text }: { text: string }) =>
      inline(text).map((s: Span) =>
        s.k === "t" ? s.text
        : s.k === "code" ? html`<code>${s.text}</code>`
        : s.k === "b" ? html`<b>${s.text}</b>`
        : s.k === "i" ? html`<i>${s.text}</i>`
        : s.k === "a" ? html`<a href=${s.href} target="_blank" rel="noopener noreferrer">${s.text}</a>`
        : title(s.id) ? html`<a class="t" onClick=${() => open(s.id)}>${s.text ?? title(s.id)}</a>` : (s.text ?? s.id),
      );
    const BlockView = ({ b }: { b: Block }) =>
      b.k === "p" ? html`<p><${Spans} text=${b.text} /></p>`
      : b.k === "ul" ? html`<ul>${b.items.map((t) => html`<li><${Spans} text=${t} /></li>`)}</ul>`
      : b.k === "ol" ? html`<ol>${b.items.map((t) => html`<li><${Spans} text=${t} /></li>`)}</ol>`
      : b.k === "quote" ? html`<blockquote><${Spans} text=${b.text} /></blockquote>`
      : b.k === "code" ? html`<pre>${b.text}</pre>`
      : html`<table><thead><tr>${b.head.map((c) => html`<th><${Spans} text=${c} /></th>`)}</tr></thead><tbody>${b.rows.map((r) => html`<tr>${r.map((c) => html`<td><${Spans} text=${c} /></td>`)}</tr>`)}</tbody></table>`;
    /** A note whole: in a document nothing folds. */
    const Note = ({ text }: { text: string }) => {
      if (!text.trim()) return null;
      const n = parse(text);
      return html`<div class="dc-note">
        ${n.lead.map((b) => html`<${BlockView} b=${b} />`)}
        ${n.sections.map((s) => html`<div class="sub">${s.title}</div>${s.blocks.map((b) => html`<${BlockView} b=${b} />`)}`)}
      </div>`;
    };
    const noteOf = (n: Node) => (typeof n.row.fields.note === "string" ? n.row.fields.note : "");

    /** Work, and what is under it, as a checklist. */
    const Work = ({ nodes }: { nodes: Node[] }) => html`<ul class="dc-work">
      ${nodes.map((n) => {
        const t = index.type(n.row.type);
        const done = index.closed(n.row);
        const line = workLine(String(n.row.fields.title ?? n.row.id), noteOf(n));
        return html`<li key=${n.row.id}>
          <span class="mk">${mark(index.marks(), t, n.row.fields.status)}</span><span class=${`t${done ? " done" : ""}`} title="Open this item" onClick=${() => open(n.row.id)}><${Spans} text=${line} /></span>
          ${n.children.length > 0 && html`<${Work} nodes=${n.children} />`}
        </li>`;
      })}
    </ul>`;

    /** A section: its title as a heading, its note, then its parts, work gathered as a checklist where it falls. */
    const Section = ({ n }: { n: Node }): unknown => {
      const level = Math.min(5, n.depth + 2);
      const runs: Node[][] = [];
      for (const c of n.children) {
        const last = runs[runs.length - 1];
        if (isWork(c) && last && isWork(last[0]!)) last.push(c);
        else runs.push([c]);
      }
      return html`<div class="dc-sec" id=${`dc-${n.row.id}`}>
        ${h(`h${level}`, { class: "dc-h", title: "Open this item", onClick: () => open(n.row.id) }, String(n.row.fields.title ?? n.row.id))}
        <${Note} text=${noteOf(n)} />
        ${runs.map((run) => (isWork(run[0]!) ? html`<${Work} nodes=${run} />` : html`<${Section} n=${run[0]} />`))}
      </div>`;
    };

    const View = () => {
      const idx = useIndex();
      const q = useHere<string>(QUERY) ?? "";
      const named = useHere<Id[]>(SECTIONS);
      const src = { item: (id: Id) => idx.item(id), linksOf: (id: Id) => idx.linksOf(id), hidden: (r: { type: string; fields: Record<string, Json> }) => idx.closed(r as never) && base(r.type) !== "work" };
      const found = Array.isArray(named) && named.length ? [] : idx.run(q, LIMIT).items.map((r) => r.id);
      const nodes = outline(sections(Array.isArray(named) ? named : undefined, found, src), src);
      const jump = (id: Id) => document.getElementById(`dc-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return html`<div class="dc"><div class="dc-page">
        ${nodes.length > 2 && html`<nav class="dc-toc">${nodes.map((n) => html`<a key=${n.row.id} onClick=${() => jump(n.row.id)}>${String(n.row.fields.title ?? n.row.id)}</a>`)}</nav>`}
        ${nodes.length ? nodes.map((n) => (isWork(n) ? html`<${Work} nodes=${[n]} />` : html`<${Section} key=${n.row.id} n=${n} />`)) : html`<div class="dc-empty">${idx.ready() ? "Nothing to read here." : "Reading the map…"}</div>`}
      </div></div>`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "center", name: "document", title: "Document", view: View });
  },
};

export default document_;
