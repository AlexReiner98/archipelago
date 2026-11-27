/**
 * The review plugin, page side: the issues about the item shown
 * (`here.item`) and its parts, in any slot that is a hole beside an item.
 * It fills the Reciprocal view's `reciprocal.side`; it knows no frame or
 * beam, only `here.item` and what `review.of` answers.
 *
 * - Each open issue: its title, whether a check raised it, and **fixed** or
 *   **drop** (`items.set` on its status).
 * - **Raise**: an issue about the item, in a few words (`review.raise`).
 * - **Check**: the newest record measuring the item (or what it is part
 *   of), read for issues to raise and decide (`review.check`).
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import type { Id, Json } from "../../spec/common.ts";
import type { GraphWatch } from "../../spec/graph.ts";
import type { HereRead } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import { sheet } from "../../spec/style.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import type { Issue } from "./index.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

const HUMAN = (basis: string) => ({ of: "human" as const, basis });

/** Fewest issues shown before the rest fold under "more". */
const SHOW = 8;

const STYLE = sheet(`
.rv { padding:var(--space-3) var(--space-4); border-bottom:1px solid var(--line); display:flex; flex-direction:column; gap:var(--space-2); font-size:var(--text-m); }
.rv h4 { margin:0 0 var(--space-1); font-size:var(--text-s); text-transform:uppercase; letter-spacing:.04em; color:var(--dim); font-weight:normal; display:flex; justify-content:space-between; }
.rv .none { color:var(--dim); }
.rv ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--space-1); }
.rv li { display:grid; grid-template-columns:1fr auto; gap:var(--space-2); align-items:baseline; }
.rv li .t { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rv li .m { color:var(--dim); font-size:var(--text-xs); margin-left:var(--space-1); }
.rv button { font:inherit; font-size:var(--text-s); background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:var(--radius); padding:0 6px; cursor:pointer; }
.rv button:hover:not(:disabled) { border-color:var(--dim); }
.rv button:disabled { opacity:.5; cursor:default; }
.rv .row { display:flex; gap:var(--space-2); }
.rv input { flex:1; min-width:0; font:inherit; background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:var(--radius); padding:1px 6px; }
.rv .said { color:var(--dim); font-size:var(--text-s); }
.rv .open-dot { color:var(--failed); }
`);

const review: Plugin = {
  id: "review",
  about: "The review issues about the item shown and its parts: raise one, check a measuring record, mark one fixed or drop it.",
  inject: ["here.read", "slot.fill", "action.invoke", "graph.watch"],
  apply(ctx: Context) {
    const here = ctx.get<HereRead>("here.read");
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    const watch = ctx.get<GraphWatch>("graph.watch");

    const Issues = () => {
      const [item, setItem] = useState<Id | undefined>(here.get<Id>("here.item"));
      useEffect(() => here.watch("here.item", (c) => setItem(c.value as Id | undefined)) as () => void, []);
      const [got, setGot] = useState<{ issues: Issue[]; measures: { id: Id; title: string }[] } | null>(null);
      const [text, setText] = useState("");
      const [said, setSaid] = useState("");
      const [all, setAll] = useState(false);
      useEffect(() => {
        if (!item) return void setGot(null);
        let live = true;
        let t: ReturnType<typeof setTimeout> | undefined;
        const go = () =>
          invoke.invoke({ action: "review.of", input: { items: [item] }, authority: HUMAN("opened an item's review"), reason: "Read the review issues" }).then(
            (o) => live && o.ok && setGot(o.output as unknown as { issues: Issue[]; measures: { id: Id; title: string }[] }),
          );
        void go();
        const stop = watch.watch({ types: ["question", "record"] }, () => {
          clearTimeout(t);
          t = setTimeout(go, 120);
        });
        return () => {
          live = false;
          clearTimeout(t);
          stop();
        };
      }, [item]);
      useEffect(() => setSaid(""), [item]);
      if (!item) return null;

      const act = async (action: string, input: Record<string, Json>, basis: string, reason: string) => {
        const o = await invoke.invoke({ action, input, authority: HUMAN(basis), reason });
        if (!o.ok) setSaid(o.refused.message);
        return o;
      };
      const raise = async () => {
        const title = text.trim();
        if (!title) return;
        const o = await act("review.raise", { title, about: [item] }, `raised "${title}" in the review panel`, `Raise an issue: ${title}`);
        if (o.ok) setText("");
      };
      const newest = got?.measures.at(-1);
      const check = async () => {
        if (!newest) return;
        const o = await act("review.check", { record: newest.id }, "pressed Check in the review panel", `Check ${newest.title}`);
        if (o.ok) {
          const r = o.output as { raised: Id[]; decided: Id[] };
          setSaid(`${r.raised.length} raised, ${r.decided.length} decided.`);
        }
      };
      const close = (q: Issue, status: "decided" | "dropped") =>
        act("items.set", { id: q.id, fields: { status, ...(status === "decided" ? { outcome: "Fixed" } : {}) } }, `marked an issue ${status === "decided" ? "fixed" : "dropped"} in the review panel`, `${status === "decided" ? "Fixed" : "Drop"}: ${q.title}`);

      const issues = got?.issues ?? [];
      const shown = all ? issues : issues.slice(0, SHOW);
      return html`<div class="rv">
        <h4><span>Review</span><span>${issues.length ? html`<span class="open-dot">●</span> ${issues.length} open` : ""}</span></h4>
        ${got === null
          ? html`<div class="none">Reading…</div>`
          : issues.length
            ? html`<ul>${shown.map((q) => html`<li key=${q.id} title=${q.note ?? q.title}>
                <span class="t">${q.title}${q.measured && html`<span class="m">check</span>`}</span>
                <span class="row"><button onClick=${() => close(q, "decided")} title="It is fixed: decide the issue">fixed</button><button onClick=${() => close(q, "dropped")} title="Not an issue: drop it">drop</button></span>
              </li>`)}</ul>
              ${issues.length > SHOW && html`<div><button onClick=${() => setAll(!all)}>${all ? "fewer" : `${issues.length - SHOW} more`}</button></div>`}`
            : html`<div class="none">No open issues.</div>`}
        <div class="row">
          <input placeholder="Raise an issue…" value=${text} onInput=${(e: Event) => setText((e.target as HTMLInputElement).value)} onKeyDown=${(e: KeyboardEvent) => e.key === "Enter" && raise()} />
          <button onClick=${raise} disabled=${!text.trim()}>Raise</button>
        </div>
        <div class="row">
          <button onClick=${check} disabled=${!newest} title=${newest ? `Raise an issue on each item ${newest.title} measures over 5%, and decide the ones within it` : "No record measures this yet: solve and keep it first"}>Check the last solve</button>
        </div>
        ${said && html`<div class="said">${said}</div>`}
      </div>`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "reciprocal.side", name: "issues", title: "Review", view: Issues });
  },
};

export default review;
