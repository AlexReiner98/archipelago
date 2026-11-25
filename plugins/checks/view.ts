/**
 * Page side: the checks plugin's results, a view in `center` ("Checks",
 * `checks/results`). Tests grouped by rule or by subject, each with its
 * result, findings and a person's accept or reject; under each rule, a
 * preview of other params. It knows no domain: lint, documents or any other
 * shows the same way.
 *
 * What it shows is set by page keys, so a view item composes it as data
 * (`center: "checks/results"`, `here: { ... }`):
 *
 * - `checks.query`: which tests, in find's query (default `type:test`),
 *   such as `type:test in:<id>`;
 * - `checks.group`: `rule` (default) or `subject`;
 * - `checks.show`: the results to show (`["fail", "error"]`); absent, all.
 *
 * It reads the map through find's index and writes only through actions:
 * `checks.decide`, and `checks.preview` (which writes nothing).
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import type { Json } from "../../spec/common.ts";
import type { HereDeclare, HereRead, HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import { sheet } from "../../spec/style.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import type { FindIndex } from "../find/index.ts";
import type { Row } from "../find/query.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const VIEW_KEYS = { query: "checks.query", group: "checks.group", show: "checks.show" } as const;
const RESULTS = ["fail", "error", "blocked", "pending", "pass"] as const;
const MARK: Record<string, string> = { pass: "✓", fail: "✗", error: "!", blocked: "⊘", pending: "◌" };
const LIMIT = 500;

const STYLE = sheet(`
.ck { padding:var(--space-3) var(--space-4); overflow:auto; height:100%; box-sizing:border-box; font-size:var(--text-s); }
.ck-bar { display:flex; flex-wrap:wrap; gap:var(--space-2); align-items:center; margin-bottom:var(--space-3); }
.ck-bar .ck-dim { margin-right:var(--space-1); }
.ck-chip { border:1px solid var(--line); border-radius:var(--radius); padding:0 var(--space-2); cursor:pointer; background:none; color:var(--fg); font:inherit; }
.ck-chip.on { border-color:var(--pick); color:var(--pick); }
.ck-dim { color:var(--dim); }
.ck-group { margin-bottom:var(--space-4); }
.ck-head { display:flex; gap:var(--space-2); align-items:baseline; border-bottom:1px solid var(--line); padding-bottom:var(--space-1); margin-bottom:var(--space-1); }
.ck-head .t { font-weight:var(--bold); cursor:pointer; }
.ck-head .t:hover { color:var(--pick); }
.ck-head code { font-family:var(--mono); font-size:var(--text-xs); color:var(--dim); }
.ck-head .n { margin-left:auto; white-space:nowrap; }
.ck-row { display:grid; grid-template-columns:1.2em minmax(0,1fr) auto; gap:var(--space-2); align-items:baseline; padding:1px 0; }
.ck-row .s { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; cursor:pointer; }
.ck-row .s:hover { color:var(--pick); }
.ck-m-pass { color:var(--held); } .ck-m-fail, .ck-m-error { color:var(--failed); } .ck-m-blocked, .ck-m-pending { color:var(--dim); }
.ck-f { grid-column:2 / 4; color:var(--dim); font-size:var(--text-xs); }
.ck-f div { overflow:hidden; text-overflow:ellipsis; }
.ck-ans { display:flex; gap:var(--space-1); align-items:baseline; }
.ck-ans button { border:1px solid var(--line); border-radius:var(--radius); background:none; color:var(--dim); font:inherit; font-size:var(--text-xs); cursor:pointer; padding:0 var(--space-2); }
.ck-ans button:hover { color:var(--fg); }
.ck-ans button.chosen { color:var(--pick); border-color:var(--pick); }
.ck-try { display:flex; gap:var(--space-2); margin:var(--space-1) 0 var(--space-2); }
.ck-try input { flex:1; font-family:var(--mono); font-size:var(--text-xs); background:var(--control); color:var(--control-fg); border:1px solid var(--control-line); border-radius:var(--radius); padding:1px var(--space-2); }
.ck-out { font-size:var(--text-xs); margin-bottom:var(--space-2); }
.ck-err { color:var(--failed); font-size:var(--text-xs); }
.ck-empty { color:var(--dim); padding:var(--space-4) 0; }
`);

/** A test as the view reads it. */
interface TestRow {
  id: string;
  title: string;
  result: string;
  findings: Json[];
  decision?: string;
  decided: boolean;
  rule?: string;
  subjects: string[];
}

const HUMAN = (basis: string) => ({ of: "human" as const, basis });
const said = (f: Json): string => (f && typeof f === "object" && !Array.isArray(f) && typeof f.message === "string" ? f.message : JSON.stringify(f));

const view: Plugin = {
  id: "checks",
  about: "The checks plugin's results on the page: tests by rule or subject, with accept, reject and a preview of a rule's params.",
  inject: ["find.index", "here.declare", "here.read", "here.set", "slot.fill", "action.invoke"],
  apply(ctx: Context) {
    const index = ctx.get<FindIndex>("find.index");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    const declare = ctx.get<HereDeclare>("here.declare");
    ctx.effect(() => declare.declare({ key: VIEW_KEYS.query, scope: "page", value: { type: "string" }, doc: "Which tests the Checks view shows, in find's query; default type:test." }));
    ctx.effect(() => declare.declare({ key: VIEW_KEYS.group, scope: "page", value: { enum: ["rule", "subject"] }, doc: "How the Checks view groups tests: by rule (default) or by subject." }));
    ctx.effect(() => declare.declare({ key: VIEW_KEYS.show, scope: "page", value: { type: "array", items: { type: "string" } }, doc: "The results the Checks view shows; absent, all." }));

    const name = (id: string | undefined) => (id ? String(index.item(id)?.fields.title ?? id) : "—");
    const asTest = (r: Row): TestRow => {
      const links = index.linksOf(r.id).filter((l) => l.from === r.id);
      const f = r.fields;
      return {
        id: r.id,
        title: String(f.title ?? r.id),
        result: typeof f.result === "string" ? f.result : "pending",
        findings: Array.isArray(f.findings) ? f.findings : [],
        ...(typeof f.decision === "string" ? { decision: f.decision } : {}),
        decided: typeof f.decision === "string" && f.decided_version === f.version,
        ...(links.find((l) => l.type === "applies") ? { rule: links.find((l) => l.type === "applies")!.to } : {}),
        subjects: [...links.filter((l) => l.type === "checks"), ...links.filter((l) => l.type === "against")].map((l) => l.to),
      };
    };
    /** Opens an item on the Landscape. */
    const open = (id: string) => {
      set.set(KEYS.view, "field/field");
      set.set(KEYS.item, id);
    };
    const useKey = <T extends Json>(key: string): T | undefined => {
      const [v, setV] = useState<T | undefined>(here.get<T>(key));
      useEffect(() => here.watch(key, (c) => setV(c.value as T | undefined)) as () => void, [key]);
      return v;
    };

    const Decide = ({ t }: { t: TestRow }) => {
      const [err, setErr] = useState("");
      if (t.result !== "pass" && t.result !== "fail") return html`<span></span>`;
      const go = async (decision: "accepted" | "rejected") => {
        const out = await invoke.invoke({ action: "checks.decide", input: { test: t.id, decision }, authority: HUMAN(`pressed ${decision === "accepted" ? "accept" : "reject"} on the Checks view`), reason: `${decision === "accepted" ? "Accept" : "Reject"}: ${t.title}` });
        setErr(out.ok ? "" : out.refused.message);
      };
      const on = (d: string) => (t.decided && t.decision === d ? " chosen" : "");
      return html`<span class="ck-ans">
        <button class=${"acc" + on("accepted")} title=${t.result === "fail" ? "Accept: a real problem" : "Accept the pass"} onClick=${() => go("accepted")}>accept</button>
        <button class=${"rej" + on("rejected")} title=${t.result === "fail" ? "Reject: the rule is wrong here" : "Reject: the rule missed something"} onClick=${() => go("rejected")}>reject</button>
        ${err && html`<span class="ck-err">${err}</span>`}
      </span>`;
    };

    const TestLine = ({ t, by }: { t: TestRow; by: "rule" | "subject" }) => {
      const [open_, setOpen] = useState(false);
      const label = by === "rule" ? t.subjects.map(name).join(" · ") || t.title : name(t.rule);
      const first = t.findings[0];
      return html`<div class="ck-row" key=${t.id}>
        <span class=${`ck-m-${t.result}`} title=${t.result}>${MARK[t.result] ?? "◌"}</span>
        <span class="s" title=${`${t.title}: ${t.result}${t.findings.length ? `, ${t.findings.length} finding(s)` : ""}. Click for findings.`} onClick=${() => setOpen(!open_)}>
          ${label}${first !== undefined && html` <span class="ck-dim">— ${said(first)}${t.findings.length > 1 ? ` +${t.findings.length - 1}` : ""}</span>`}
        </span>
        <${Decide} t=${t} />
        ${open_ &&
        html`<div class="ck-f">
          ${t.findings.map((f) => html`<div title=${JSON.stringify(f)}>${said(f)}</div>`)}
          <div><a onClick=${() => open(t.id)}>open the test</a>${t.subjects.map((s) => html` · <a onClick=${() => open(s)}>${name(s)}</a>`)}${t.decision && html` · ${t.decided ? t.decision : `${t.decision} at an older version`}`}</div>
        </div>`}
      </div>`;
    };

    /** Under a rule: try other params, and see which tests would flip. */
    const Try = ({ rule }: { rule: string }) => {
      const params = index.item(rule)?.fields.params ?? {};
      const [text, setText] = useState(JSON.stringify(params));
      const [out, setOut] = useState<any>(null);
      const [err, setErr] = useState("");
      const go = async () => {
        let p: Json;
        try {
          p = JSON.parse(text);
        } catch {
          return setErr("Params are JSON.");
        }
        setErr("");
        setOut(null);
        const o = await invoke.invoke({ action: "checks.preview", input: { rule, params: p, judge: 50 }, authority: HUMAN("pressed preview on the Checks view"), reason: `Preview params for ${name(rule)}` });
        if (!o.ok) return setErr(o.refused.message);
        setOut(o.output);
      };
      return html`<div>
        <div class="ck-try"><input value=${text} onInput=${(e: any) => setText(e.target.value)} onKeyDown=${(e: any) => e.key === "Enter" && go()} title="Params to try: nothing is written" /><button class="ck-chip" onClick=${go} title="Solve this rule's tests against these params, in memory. Judges only the tests that move, at most 50.">preview</button></div>
        ${err && html`<div class="ck-err">${err}</div>`}
        ${out &&
        html`<div class="ck-out">
          ${out.tests.length ? html`${out.flips} of ${out.tests.length} moved would flip${out.held_back ? html`, ${out.held_back} not judged` : ""}:` : "Nothing would move."}
          ${out.tests.filter((t: any) => t.flips).map((t: any) => html`<div>${name(t.test)}: <span class=${`ck-m-${t.before.result}`}>${t.before.result}</span> → <span class=${`ck-m-${t.after.result}`}>${t.after.result}</span></div>`)}
        </div>`}
      </div>`;
    };

    const Results = () => {
      const [, tick] = useState(0);
      useEffect(() => index.watch(() => tick((x) => x + 1)) as () => void, []);
      const query = useKey<string>(VIEW_KEYS.query) || "type:test";
      const by = useKey<string>(VIEW_KEYS.group) === "subject" ? "subject" : "rule";
      const show = useKey<string[]>(VIEW_KEYS.show);
      const [trying, setTrying] = useState<string | null>(null);
      if (!index.ready()) return html`<div class="ck ck-empty">Reading the map…</div>`;
      const found = index.run(query, LIMIT);
      const all = found.items.filter((r) => r.type === "test").map(asTest);
      const counts = Object.fromEntries(RESULTS.map((k) => [k, all.filter((t) => t.result === k).length]));
      const tests = Array.isArray(show) && show.length ? all.filter((t) => show.includes(t.result)) : all;
      const groups = new Map<string, TestRow[]>();
      for (const t of tests) {
        const k = (by === "rule" ? t.rule : t.subjects[0]) ?? "";
        (groups.get(k) ?? groups.set(k, []).get(k)!).push(t);
      }
      const order = [...groups].sort((a, b) => name(a[0]).localeCompare(name(b[0])));
      const toggle = (k: string) => {
        const now = new Set(Array.isArray(show) ? show : []);
        if (now.has(k)) now.delete(k);
        else now.add(k);
        set.set(VIEW_KEYS.show, now.size ? [...now] : undefined);
      };
      return html`<div class="ck">
        <div class="ck-bar">
          <span class="ck-dim">by</span>
          ${(["rule", "subject"] as const).map((g) => html`<button class=${`ck-chip${by === g ? " on" : ""}`} onClick=${() => set.set(VIEW_KEYS.group, g === "rule" ? undefined : g)}>${g}</button>`)}
          <span class="ck-dim" style="margin-left:var(--space-3)">show</span>
          ${RESULTS.map((k) => html`<button class=${`ck-chip${Array.isArray(show) && show.includes(k) ? " on" : ""}`} title=${`Only ${k} (click again to drop)`} onClick=${() => toggle(k)}><span class=${`ck-m-${k}`}>${MARK[k]}</span> ${counts[k]}</button>`)}
          <span class="ck-dim" style="margin-left:auto" title="checks.query">${query}${found.more ? ` · ${found.more} more not shown` : ""}</span>
        </div>
        ${!all.length && html`<div class="ck-empty">No tests here. A domain's rules and tests show here as they are made; lint's are made by <code>lint.cover</code>.</div>`}
        ${order.map(([k, ts]) => {
          const it = k ? index.item(k) : undefined;
          const bad = ts.filter((t) => t.result === "fail" || t.result === "error").length;
          return html`<div class="ck-group" key=${k}>
            <div class="ck-head">
              <span class="t" title="Open on the Landscape" onClick=${() => k && open(k)}>${k ? name(k) : by === "rule" ? "No rule" : "No subject"}</span>
              ${by === "rule" && it && html`<code>${String(it.fields.fn ?? "")} ${JSON.stringify(it.fields.params ?? {})}</code>`}
              ${by === "subject" && it && html`<code>${it.type}</code>`}
              <span class="n ck-dim">${bad ? html`<span class="ck-m-fail">${bad} failing</span> · ` : ""}${ts.length} test${ts.length === 1 ? "" : "s"}</span>
              ${by === "rule" && k && html`<button class=${`ck-chip${trying === k ? " on" : ""}`} title="Preview other params" onClick=${() => setTrying(trying === k ? null : k)}>try</button>`}
            </div>
            ${by === "rule" && trying === k && html`<${Try} rule=${k} />`}
            ${ts.sort((a, b) => RESULTS.indexOf(a.result as never) - RESULTS.indexOf(b.result as never)).map((t) => html`<${TestLine} key=${t.id} t=${t} by=${by} />`)}
          </div>`;
        })}
      </div>`;
    };

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    ctx.get<SlotFill>("slot.fill").fill({ slot: "center", name: "results", title: "Checks", view: Results });
  },
};

export default view;
