/**
 * Markdown blocks (markdown.ts) drawn as Preact, for the Guide (guide.ts).
 * Nothing is set as markup: every element is built from a block. How a
 * link opens is the caller's (`Link`), so a link to another chapter stays
 * in the Guide.
 */
import { h } from "preact";
import htm from "htm";
import { inline, type Block, type Inline } from "./markdown.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** Draws a link: its href as written, and what it shows. */
export type LinkView = (p: { href: string; children: unknown }) => unknown;

/** A line's inline marks. */
export function Text({ text, Link }: { text: string; Link: LinkView }): unknown {
  const draw = (parts: Inline[]): unknown[] =>
    parts.map((p, k) => {
      if (p.t === "text") return p.text;
      if (p.t === "code") return html`<code key=${k}>${p.text}</code>`;
      if (p.t === "b") return html`<b key=${k}>${draw(p.parts)}</b>`;
      if (p.t === "i") return html`<i key=${k}>${draw(p.parts)}</i>`;
      return html`<${Link} key=${k} href=${p.href}>${draw(p.parts)}<//>`;
    });
  return html`${draw(inline(text))}`;
}

/** Some blocks. A heading gets its anchor as an id, prefixed so it can't meet the page's own. */
export function Blocks({ blocks, Link }: { blocks: Block[]; Link: LinkView }): unknown {
  return html`${blocks.map((b, k) => {
    if (b.t === "h") return h(`h${Math.min(6, b.level + 2)}`, { key: k, id: `gd-${b.id}`, class: "gd-sub" }, html`<${Text} text=${b.text} Link=${Link} />`);
    if (b.t === "p") return html`<p key=${k}><${Text} text=${b.text} Link=${Link} /></p>`;
    if (b.t === "code") return html`<pre key=${k}><code>${b.text}</code></pre>`;
    if (b.t === "quote") return html`<blockquote key=${k}><${Blocks} blocks=${b.blocks} Link=${Link} /></blockquote>`;
    if (b.t === "list") {
      const items = b.items.map((it, j) => html`<li key=${j}><${Blocks} blocks=${it} Link=${Link} /></li>`);
      return b.ordered ? html`<ol key=${k}>${items}</ol>` : html`<ul key=${k}>${items}</ul>`;
    }
    return html`<div key=${k} class="gd-table"><table>
      <thead><tr>${b.head.map((c, j) => html`<th key=${j}><${Text} text=${c} Link=${Link} /></th>`)}</tr></thead>
      <tbody>${b.rows.map((r, j) => html`<tr key=${j}>${r.map((c, i) => html`<td key=${i}><${Text} text=${c} Link=${Link} /></td>`)}</tr>`)}</tbody>
    </table></div>`;
  })}`;
}
