/**
 * The Context interface's part for the keep pack (packs/keep): each trial node's
 * record, standing and checks, read through the action `keep.review`, and
 * the buttons that keep or retire one (`keep.apply`, as the person at the
 * page). Without the keep pack there is nothing to show, and nothing is.
 *
 * - `useReview()`: the review, read again whenever verdicts or node items
 *   change.
 * - `Tag`: the tree row's mark for a node: its standing, or held back.
 * - `Decided`: the tree's last group, the nodes promoted or retired, by
 *   record or by a person, retired ones included (no longer loaded).
 * - `Standing`: the node pane's section.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke, ActionList } from "../../spec/action.ts";
import type { GraphWatch } from "../../spec/graph.ts";
import { read, sheet, verdictGlyph } from "../../spec/style.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const REVIEW = "keep.review";
export const APPLY = "keep.apply";

/** What `keep.review` answers (packs/keep). */
export interface Reviewed {
  item: string;
  node?: string;
  title: string;
  at: string[];
  status: string;
  record?: { said: number; runs: number; held: number; failed: number; quiet: number; last?: string };
  replayed?: { said: number; runs: number; held: number; failed: number; quiet: number };
  labels?: { allow: number; deny: number; agree: number; disagree: number };
  standing?: { state: "trial" | "promote" | "retire"; rule?: string; why: string; of?: string };
  checks: string[];
  decided?: { state: "promote" | "retire"; rule?: string; why: string; by: string; at: string; node?: string; record?: { runs: number; held: number; failed: number; quiet: number } };
}
export interface Review {
  thresholds: { promote: number; fail: number; idle: number; same: number; replay?: number };
  apply: boolean;
  nodes: Reviewed[];
}

export const KEEP_STYLE = sheet(`
.hv-tag.up { border-style:solid; border-color:var(--held); color:var(--held); }
.hv-tag.down { border-style:solid; border-color:var(--failed); color:var(--failed); }
.hv-tag.gone { border-style:solid; border-color:var(--failed); background:color-mix(in srgb, var(--failed) 15%, transparent); color:var(--failed); }
.hv-why { margin:1px var(--space-4); color:var(--dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hv-check { margin:1px var(--space-4); padding:0 var(--space-3); border-left:3px solid var(--failed); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hv-dec { color:var(--dim); }
.hv-dec.retired .x { text-decoration:line-through; }
`);

interface Deps {
  actions: ActionList;
  invoke: ActionInvoke;
  graphLive: GraphWatch;
  /** Calls `on` after verdicts may have changed. */
  onVerdicts(on: () => void): () => void;
  /** Sets the node looked at. */
  pick(node: string): void;
}

/** Who decided, in words. */
const who = (by: string): string => (by === "pack:keep" ? "by its record" : by.startsWith("person:") ? "by a person" : `by ${by}`);

export function keepParts({ actions, invoke, graphLive, onVerdicts, pick }: Deps) {
  const has = (name: string) => actions.list().some((a) => a.name === name);

  const useReview = (): Review | undefined => {
    const [r, setR] = useState<Review>();
    const [on, setOn] = useState(has(REVIEW));
    useEffect(() => actions.watch(() => setOn(has(REVIEW))) as () => void, []);
    useEffect(() => {
      if (!on) return setR(undefined);
      let gone = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const load = () =>
        void invoke
          .invoke({ action: REVIEW, input: {}, authority: { of: "human", basis: "read in the context interface" }, reason: "Show each trial node's standing" })
          .then((out) => !gone && out.ok && setR(out.output as unknown as Review));
      const later = () => {
        clearTimeout(timer);
        timer = setTimeout(load, 300);
      };
      load();
      const a = onVerdicts(later);
      const b = graphLive.watch({ types: ["node"] }, later);
      return () => {
        gone = true;
        clearTimeout(timer);
        a();
        void b();
      };
    }, [on]);
    return r;
  };

  /** The tree row's mark: held back beats standing. */
  const Tag = ({ r }: { r?: Reviewed }) => {
    if (!r) return null;
    if (r.checks.length) return html`<span class="hv-tag gone" title=${r.checks.join("\n")}>held back</span>`;
    const s = r.standing;
    if (!s) return null;
    if (s.state === "promote") return html`<span class="hv-tag up" title=${s.why}>promote</span>`;
    if (s.state === "retire") return html`<span class="hv-tag down" title=${s.why}>retire: ${s.rule}</span>`;
    return html`<span class="hv-tag" title=${s.why}>trial</span>`;
  };

  /** The nodes promoted or retired, newest first. */
  const Decided = ({ review, picked }: { review?: Review; picked?: string }) => {
    const list = (review?.nodes ?? []).filter((r) => r.decided).sort((a, b) => b.decided!.at.localeCompare(a.decided!.at));
    if (!list.length) return null;
    return html`
      <div class="hv-group" title="Promoted or retired by the keep pack's rules, or by a person: history.undo takes one back">decided: kept or retired</div>
      ${list.map((r) => {
        const id = r.node ?? r.decided!.node;
        const up = r.decided!.state === "promote";
        return html`
          <div class=${`hv-row hv-dec ${up ? "" : "retired"} ${picked && picked === id ? "hv-lit hv-pick" : ""}`} title=${`${r.decided!.why}\n${who(r.decided!.by)}, ${new Date(r.decided!.at).toLocaleString()}`} onClick=${() => id && pick(id)}>
            <span class=${`hv-m ${up ? "m-held" : "m-failed"}`}>${up ? "↑" : "↓"}</span>
            <span class="x">${r.title}</span>
            <span class=${`hv-tag ${up ? "up" : "down"}`}>${up ? "kept" : "retired"}${r.decided!.rule ? `: ${r.decided!.rule}` : ""}</span>
          </div>
        `;
      })}
    `;
  };

  /** The node pane's section: the record against the thresholds, the checks, and keep or retire. */
  const Standing = ({ review, id, source }: { review?: Review; id: string; source?: string }) => {
    const [status, setStatus] = useState("");
    useEffect(() => setStatus(""), [id]);
    const r = review?.nodes.find((x) => (source && x.item === source) || x.node === id || x.decided?.node === id);
    if (!review || !r) return null;
    const t = review.thresholds;
    const apply = async (state: "promote" | "retire") => {
      setStatus("…");
      const out = await invoke.invoke({
        action: APPLY,
        input: { node: r.item, state, why: state === "promote" ? "Kept in the context interface" : "Retired in the context interface" },
        authority: { of: "human", basis: state === "promote" ? "kept in the context interface" : "retired in the context interface" },
        reason: `${state === "promote" ? "Kept" : "Retired"} ${r.title} in the context interface`,
      });
      setStatus(out.ok ? "" : `refused: ${out.refused.message}`);
    };
    const s = r.standing;
    const by = r.decided ? (r.decided.by === "pack:keep" ? "by record" : "by hand") : "";
    const head =
      r.status === "retired" ? `retired ${by}` : r.status === "trial" ? (s?.state === "trial" ? "trial" : `trial → ${s?.state}${review.apply ? "" : " (apply off)"}`) : `kept ${by}`;
    const w = t.replay ?? 0.5;
    const rules = `Promotes at ${t.promote} held runs, one of them live. Retires at ${t.fail} failed live runs, after ${t.idle} runs with nothing held or failed, or as a ${Math.round(t.same * 100)}% duplicate. A replayed run counts ${w} of a live one toward held and quiet, and its failures count toward nothing: the agent never heard the node. The keep pack's config.`;
    const why = s?.why ?? r.decided?.why ?? "";
    const rec = r.record;
    const rep = r.replayed;
    const lab = r.labels;
    return html`
      <div class="hv-group" title=${rules}>standing · ${head}</div>
      ${(rec || rep) && html`<div class="hv-why" title=${`Live: runs where an agent heard it${rec ? `, said ${rec.said} times in ${rec.runs}` : ", none yet"}`}>live ${rec?.runs ?? 0} · <span class="m-held">${read(verdictGlyph("held"))} ${rec?.held ?? 0}/${t.promote}</span> · <span class="m-failed">${read(verdictGlyph("failed"))} ${rec?.failed ?? 0}/${t.fail}</span> · <span class="m-quiet">${read(verdictGlyph("quiet"))} ${rec?.quiet ?? 0}/${t.idle}</span></div>`}
      ${rep && html`<div class="hv-why" title=${`Replayed: recorded runs played again with it said, each counting ${w} of a live run toward held and quiet; a replayed failure counts toward nothing`}>replayed ${rep.runs} × ${w} · <span class="m-held">${read(verdictGlyph("held"))} ${rep.held}</span> · <span class="m-failed">${read(verdictGlyph("failed"))} ${rep.failed}</span> · <span class="m-quiet">${read(verdictGlyph("quiet"))} ${rep.quiet}</span></div>`}
      ${lab && html`<div class="hv-why" title="A person's allow or deny after it was said, against its verdict there: held with allow and failed with deny agree">labels · allow ${lab.allow} · deny ${lab.deny} · <span class=${lab.disagree ? "m-failed" : "m-held"}>agree ${lab.agree}/${lab.agree + lab.disagree}</span></div>`}
      ${why && html`<div class="hv-why" title=${why}>${why}</div>`}
      ${r.checks.map((c) => html`<div class="hv-check" title=${`Held back from every run: ${c}`}>⊝ ${c}</div>`)}
      ${has(APPLY) && html`<div class="hv-words"><div class="bar">
        ${r.status !== "kept" && html`<button class="hv-btn" title="Said as kept from now on" onClick=${() => apply("promote")}>${r.status === "retired" ? "Bring back" : "Keep"}</button>`}
        ${r.status !== "retired" && html`<button class="hv-btn" title="No longer said" onClick=${() => apply("retire")}>Retire</button>`}
        <span style="overflow:hidden;text-overflow:ellipsis" title=${status}>${status}</span>
      </div></div>`}
    `;
  };

  return { useReview, Tag, Decided, Standing };
}
