/**
 * The item page's parts, each drawn from what read.ts and note.ts work out:
 * the note with its sections folded, the fields as marks, the neighbours
 * by kind of link, and the history with an undo on each change.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import { UNDO, attested } from "../../spec/action.ts";
import type { Fact, Header } from "../../spec/changeset.ts";
import type { Id, Json, Page } from "../../spec/common.ts";
import type { Block, Span } from "./note.ts";
import { inline, parse } from "./note.ts";
import type { Group, Line, Mark } from "./read.ts";
import { ago, brief, others, words } from "./read.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** What the parts are handed by the page. */
export interface Deps {
  /** An item's name, if it is on the map. */
  name(id: Id): string | undefined;
  /** An item's mark: its glyph and side. */
  mark(id: Id): { glyph: string; side: string };
  /** Opens an item on the page. */
  open(id: Id): void;
  invoke: ActionInvoke;
}

/** What `history.list` answers per entry (packs/history). */
export interface Entry {
  id: string;
  committed: string;
  header: Header;
  facts: Fact[];
  undoneBy?: string;
}

const HUMAN = (basis: string) => ({ of: "human" as const, basis });

export function parts(d: Deps) {
  const Mk = ({ id }: { id: Id }) => {
    const m = d.mark(id);
    return html`<span class=${`ip-mk s-${m.side}`}>${m.glyph}</span>`;
  };

  /** An item named in a note, a mark or a line: its name, one click away. */
  const Ref = ({ id, text }: { id: Id; text?: string }) => {
    const n = d.name(id);
    if (!n) return html`<span class="ip-dim" title="Not on the map now">${text ?? id}</span>`;
    return html`<a class="ip-ref" title=${n} onClick=${() => d.open(id)}><${Mk} id=${id} />${text ?? n}</a>`;
  };

  const Spans = ({ text }: { text: string }) =>
    inline(text).map((s: Span) =>
      s.k === "t" ? s.text
      : s.k === "code" ? html`<code>${s.text}</code>`
      : s.k === "b" ? html`<b>${s.text}</b>`
      : s.k === "i" ? html`<i>${s.text}</i>`
      : s.k === "a" ? html`<a href=${s.href} target="_blank" rel="noopener noreferrer">${s.text}</a>`
      : html`<${Ref} id=${s.id} text=${s.text} />`,
    );

  const BlockView = ({ b }: { b: Block }) =>
    b.k === "p" ? html`<p><${Spans} text=${b.text} /></p>`
    : b.k === "ul" ? html`<ul>${b.items.map((t) => html`<li><${Spans} text=${t} /></li>`)}</ul>`
    : b.k === "ol" ? html`<ol>${b.items.map((t) => html`<li><${Spans} text=${t} /></li>`)}</ol>`
    : b.k === "quote" ? html`<blockquote><${Spans} text=${b.text} /></blockquote>`
    : b.k === "code" ? html`<pre>${b.text}</pre>`
    : html`<table><thead><tr>${b.head.map((c) => html`<th><${Spans} text=${c} /></th>`)}</tr></thead><tbody>${b.rows.map((r) => html`<tr>${r.map((c) => html`<td><${Spans} text=${c} /></td>`)}</tr>`)}</tbody></table>`;

  /** The note: its first block leads; the rest of the lead and each section fold. */
  const Note = ({ text }: { text: string }) => {
    const n = parse(text);
    const [first, ...more] = n.lead;
    return html`
      <div class="ip-note">
        ${first && html`<${BlockView} b=${first} />`}
        ${more.length > 0 && html`<details class="ip-fold"><summary>more</summary>${more.map((b) => html`<${BlockView} b=${b} />`)}</details>`}
        ${n.sections.map(
          (s) => html`
            <details class="ip-fold" style=${`margin-left:${Math.max(0, s.depth - 2) * 12}px`}>
              <summary><${Spans} text=${s.title} /></summary>
              ${s.blocks.map((b) => html`<${BlockView} b=${b} />`)}
            </details>
          `,
        )}
      </div>
    `;
  };

  const Marks = ({ marks }: { marks: Mark[] }) =>
    marks.length > 0 &&
    html`<div class="ip-marks">
      ${marks.map((m) =>
        m.id
          ? html`<span class="ip-chip" title=${m.full}>${m.field} <${Ref} id=${m.id} /></span>`
          : html`<span class="ip-chip" title=${m.full}>${m.text}</span>`,
      )}
    </div>`;

  const SHOW = 6;
  const GroupView = ({ g }: { g: Group }) => {
    const [all, setAll] = useState(false);
    const ends = all ? g.ends : g.ends.slice(0, SHOW);
    return html`
      <div class="ip-group">
        <div class="ip-kind" title=${g.dir === "out" ? `This ${g.label} these` : `These ${g.label} this`}>${g.dir === "out" ? "→" : "←"} ${g.label} <span class="ip-dim">${g.ends.length}</span></div>
        ${ends.map((e) => html`<div class="ip-end" key=${e.link} onClick=${() => d.open(e.id)}><${Mk} id=${e.id} /><span class="v">${d.name(e.id) ?? e.id}</span>${e.for && html`<span class="ip-dim"> · ${e.for}</span>`}</div>`)}
        ${g.ends.length > SHOW && !all && html`<button class="ip-more" onClick=${() => setAll(true)}>${g.ends.length - SHOW} more</button>`}
      </div>
    `;
  };
  const Neighbours = ({ groups }: { groups: Group[] }) =>
    groups.length > 0 && html`<div class="ip-near">${groups.map((g) => html`<${GroupView} key=${`${g.dir} ${g.kind}`} g=${g} />`)}</div>`;

  const LineView = ({ l }: { l: Line }) => {
    if (l.k === "made") return html`<span>made</span>`;
    if (l.k === "removed") return html`<span>removed</span>`;
    if (l.k === "set") {
      const from = brief(l.from), to = brief(l.to);
      if (l.to === undefined) return html`<span>${l.field} cleared</span>`;
      if (from === undefined && to === undefined) return html`<span>${l.field} changed</span>`;
      return html`<span>${l.field} ${from !== undefined && html`<s class="ip-dim">${from}</s> `}→ ${to ?? "…"}</span>`;
    }
    return html`<span>${l.k} ${l.dir === "out" ? "→" : "←"} ${words(l.kind)} <${Ref} id=${l.other} /></span>`;
  };

  /** The changes that touched this item, newest first, a page at a time; each can be undone. */
  const History = ({ id, tick, lines }: { id: Id; tick: string; lines: (id: Id, facts: Fact[]) => Line[] }) => {
    const [entries, setEntries] = useState<Entry[]>([]);
    const [next, setNext] = useState<string | undefined>();
    const [said, setSaid] = useState<Record<string, string>>({});
    const load = async (after?: string) => {
      const out = await d.invoke.invoke<Json>({
        action: "history.list",
        input: { item: id, limit: 10, ...(after ? { after } : {}) },
        authority: HUMAN("looked at the item page"),
        reason: "Show this item's history",
      });
      if (!out.ok) return;
      const page = out.output as unknown as Page<Entry>;
      setEntries((was) => (after ? [...was, ...page.items] : page.items));
      setNext(page.next);
    };
    useEffect(() => void load(), [id, tick]);
    const undo = async (e: Entry) => {
      const out = await d.invoke.invoke({ action: UNDO, input: { change: e.id }, authority: HUMAN("pressed undo on the item page"), reason: `Undo: ${e.header.reason}` });
      setSaid((s) => ({ ...s, [e.id]: out.ok ? "" : out.refused.message }));
    };
    if (entries.length === 0) return null;
    return html`
      <div class="ip-hist">
        ${entries.map((e) => {
          const test = attested(e.header);
          const who = test ? `test at ${test.version.slice(0, 7)}` : e.header.actor.kind === "person" ? e.header.actor.id.replace(/^person:/, "") : e.header.actor.id;
          const whose = test ? `a test's result · ${test.test} at ${test.version}` : `${e.header.actor.kind} · ${e.header.authority.of === "human" ? `told: ${e.header.authority.basis}` : "own judgment"}`;
          const undone = !!e.undoneBy;
          return html`
            <div class=${`ip-change${undone ? " undone" : ""}`} key=${e.id}>
              <div class="ip-change-head">
                <span class="ip-who" title=${whose}>${test ? "▲" : e.header.actor.kind === "person" ? "●" : "◆"} ${who}</span>
                <span class="ip-dim" title=${e.committed}>${ago(e.committed)}</span>
                ${e.header.undoes && html`<span class="ip-dim">undo</span>`}
                ${undone
                  ? html`<span class="ip-dim ip-right" title=${`Undone by ${e.undoneBy}`}>undone</span>`
                  : html`<button class="ip-undo ip-right" title="Apply its inverse as a new change" onClick=${() => undo(e)}>${e.header.undoes ? "redo" : "undo"}</button>`}
              </div>
              <div class="ip-why" title=${e.header.reason}>${e.header.reason}</div>
              ${lines(id, e.facts).map((l) => html`<div class="ip-line"><${LineView} l=${l} /></div>`)}
              ${(() => {
                const n = others(id, e.facts);
                return n > 0 && html`<div class="ip-line ip-dim" title="Undo takes back the whole change">and ${n} other ${n === 1 ? "item" : "items"}</div>`;
              })()}
              ${said[e.id] && html`<div class="ip-refused">${said[e.id]}</div>`}
            </div>
          `;
        })}
        ${next && html`<button class="ip-more" onClick=${() => load(next)}>older</button>`}
      </div>
    `;
  };

  return { Mk, Note, Marks, Neighbours, History };
}
