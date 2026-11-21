/**
 * The find line, drawn: an input that sets `find.query`, and under it what
 * `suggest` offers, terms by kind and then items. Arrows move, Enter picks,
 * Escape closes. A term goes into the line; an item is jumped to.
 *
 * `command` is the Ctrl+K form: it takes the focus, an item is highlighted
 * from the start so Enter jumps, and it calls `done` when it has done its
 * work or is dismissed.
 */
import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { Id } from "../../spec/common.ts";
import type { HereRead, HereSet } from "../../spec/here.ts";
import { glyph, read, shape, side, sheet } from "../../spec/style.ts";
import type { TypeInfo } from "../../spec/types.ts";
import { run, type Index, type Result } from "./query.ts";
import { suggest, type Suggestion } from "./suggest.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export interface LineProps {
  command?: boolean;
  done?: () => void;
}

export const STYLE = sheet(`
.fd { position:relative; display:flex; align-items:center; gap:var(--space-3); flex:1; min-width:0; }
.fd input { flex:1; min-width:0; font:inherit; background:var(--control); color:var(--fg); border:1px solid var(--control-line); border-radius:var(--radius); padding:var(--space-1) var(--space-3); }
.fd .n { color:var(--dim); white-space:nowrap; font-variant-numeric:tabular-nums; }
.fd-list { position:absolute; top:calc(100% + var(--space-1)); left:0; right:0; z-index:20; background:var(--panel); border:1px solid var(--control-line); border-radius:var(--radius); padding:var(--space-1) 0; white-space:nowrap; box-shadow:0 4px 14px color-mix(in srgb, var(--fg) 14%, transparent); }
.fd-row { display:flex; gap:var(--space-3); align-items:baseline; padding:var(--space-1) var(--space-3); cursor:pointer; }
.fd-row.on { background:color-mix(in srgb, var(--pick) 16%, transparent); }
.fd-row .k { color:var(--dim); width:3.6em; flex:none; font-size:var(--text-s); }
.fd-row .t { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; }
.fd-row .hn { color:var(--dim); font-size:var(--text-s); overflow:hidden; text-overflow:ellipsis; max-width:45%; }
.fd-row .mk { width:3.6em; flex:none; text-align:center; }
.fd-row .mk.s-fresh { color:var(--mark-fresh); } .fd-row .mk.s-moving { color:var(--mark-moving); } .fd-row .mk.s-done { color:var(--mark-done); } .fd-row .mk.s-gone { color:var(--mark-gone); }
.fd-sep { border-top:1px solid var(--line); margin:var(--space-1) 0; }
.fd.cmd { flex-direction:column; align-items:stretch; gap:0; }
.fd.cmd input { font-size:var(--text-l); padding:var(--space-3) var(--space-4); }
.fd.cmd .fd-list { position:static; margin-top:var(--space-2); box-shadow:none; }
`);

/** What the line draws with: `find`'s copy of the map, its watchers, and here. */
export interface LineDeps {
  index: Index;
  types: () => TypeInfo[];
  watchers: Set<() => void>;
  here: HereRead;
  set: HereSet;
  query: string;
  jump: (id: Id) => void;
}

export function makeLine(d: LineDeps) {
  return function Line({ command, done }: LineProps) {
    const [q, setQ] = useState(command ? "" : (d.here.get<string>(d.query) ?? ""));
    const [n, setN] = useState<Result | undefined>();
    const [open, setOpen] = useState(!!command);
    const [sel, setSel] = useState(-1);
    const [, tick] = useState(0);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
      if (command) return input.current?.focus();
      return d.here.watch(d.query, (c) => setQ(typeof c.value === "string" ? c.value : "")) as () => void;
    }, []);
    useEffect(() => {
      const count = () => (setN(run(d.index, q)), tick((x) => x + 1));
      count();
      d.watchers.add(count);
      return () => void d.watchers.delete(count);
    }, [q]);

    const list = open ? suggest(d.index, q) : [];
    // The command line starts on the first item, so Enter jumps.
    useEffect(() => setSel(command ? list.findIndex((s) => s.kind === "item") : -1), [q, open]);

    const setQuery = (v: string, now = false) => {
      clearTimeout(timer.current);
      if (now) d.set.set(d.query, v.trim() || undefined);
      else timer.current = setTimeout(() => d.set.set(d.query, v.trim() || undefined), 150);
    };
    const type = (v: string) => {
      setQ(v);
      setOpen(true);
      if (!command) setQuery(v);
    };
    const pick = (s: Suggestion) => {
      if (s.kind === "term") {
        setQ(s.line);
        if (!command) setQuery(s.line, true);
        input.current?.focus();
        return;
      }
      clearTimeout(timer.current);
      // The line's words, not yet sent, are the query the jump keeps or replaces.
      if (!command) d.set.set(d.query, q.trim() || undefined);
      d.jump(s.id);
      setOpen(false);
      done?.();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!list.length) return;
        const step = e.key === "ArrowDown" ? 1 : -1;
        // Through -1 (none) and each row, round.
        setSel((s) => ((s + 1 + step + list.length + 1) % (list.length + 1)) - 1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const s = list[sel];
        if (s) return pick(s);
        setOpen(false);
        if (command) setQuery(q, true), done?.();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (command) return done?.();
        setOpen(false);
        input.current?.blur();
      }
    };

    const bases = d.types().filter((t) => t.base === t.name).map((t) => t.name);
    const row = (s: Suggestion, i: number) => {
      const on = i === sel ? " on" : "";
      const hold = (e: Event) => e.preventDefault();
      // An item as a term (in:, near:, id:) shows by its title; the id is in the tooltip.
      if (s.kind === "term" && s.of === "item")
        return html`<div class=${`fd-row${on}`} key=${s.term} onMouseDown=${hold} onClick=${() => pick(s)} onMouseEnter=${() => setSel(i)} title=${s.term}>
          <span class="k">${s.term.slice(0, s.term.indexOf(":") + 1)}</span><span class="t">${s.hint}</span>
        </div>`;
      if (s.kind === "term")
        return html`<div class=${`fd-row${on}`} key=${s.term} onMouseDown=${hold} onClick=${() => pick(s)} onMouseEnter=${() => setSel(i)} title=${s.hint ?? ""}>
          <span class="k">${s.of}</span><span class="t">${s.term}</span>
        </div>`;
      const t = d.index.type(s.type);
      return html`<div class=${`fd-row${on}`} key=${s.id} onMouseDown=${hold} onClick=${() => pick(s)} onMouseEnter=${() => setSel(i)} title=${s.id}>
        <span class=${`mk s-${side(t, s.status)}`}>${read(glyph(shape(bases, t), side(t, s.status)))}</span><span class="t">${s.title}</span><span class="hn">${s.type} · ${s.status}</span>
      </div>`;
    };
    const firstItem = list.findIndex((s) => s.kind === "item");

    return html`
      <div class=${`fd${command ? " cmd" : ""}`}>
        <input
          ref=${input}
          autoFocus=${!!command}
          value=${q}
          placeholder=${command ? "Jump to an item, or find: words, is:open, type:…" : "find: words, is:open, type:question, in:<id>"}
          title="words match titles · is:open is:closed · status:x · type:x · in:<id> · near:<id> · Ctrl+K jumps"
          onInput=${(e: Event) => type((e.target as HTMLInputElement).value)}
          onFocus=${() => setOpen(true)}
          onBlur=${() => !command && setOpen(false)}
          onKeyDown=${key}
        />
        ${!command && html`<span class="n">${n ? `${n.items.length}${n.more ? ` of ${n.items.length + n.more}` : ""}` : ""}</span>`}
        ${list.length > 0 &&
        html`<div class="fd-list">${list.map((s, i) => [i === firstItem && i > 0 && html`<div class="fd-sep" key="sep" />`, row(s, i)])}</div>`}
      </div>
    `;
  };
}
