/**
 * The harness view's left pane: the node looked at (`here.node`). Its
 * words, edited through `words.set` when made from a map item; a trial's
 * miss and its retiring (`words.retire`); its standing by the keep pack;
 * a written file's rule (`written.rule`); its places, pack and kind; its
 * record, and its verdict in each run, a click away from that run.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import type { NodeInfo } from "../../spec/agent.ts";
import type { ExchangeRead } from "../../spec/exchange.ts";
import type { HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import { read as token, verdictGlyph } from "../../spec/style.ts";
import { Mark } from "./events.ts";
import type { Hooks, VerdictRead } from "./hooks.ts";
import type { keepParts, Review } from "./keep.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** The action that changes a node's words, when a pack provides it. */
export const EDIT = "words.set";
/** The action that retires a node made from a map item. */
const RETIRE = "words.retire";
/** The action that opens a written node to refinement or holds it (packs/written). */
const RULE = "written.rule";

const clock = (t?: string) => (t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");
const mark = (x: "held" | "failed" | "quiet") => token(verdictGlyph(x));

interface Deps {
  hk: Hooks;
  invoke: ActionInvoke;
  set: HereSet;
  read: ExchangeRead;
  verdicts: VerdictRead;
  kp: ReturnType<typeof keepParts>;
}

export function nodePane({ hk, invoke, set, read, verdicts, kp }: Deps) {
  const Words = ({ info, editable }: { info: NodeInfo; editable: boolean }) => {
    const item = hk.useItem(info.source);
    const saved = typeof item?.fields.words === "string" ? item.fields.words : undefined;
    const [draft, setDraft] = useState<string | undefined>();
    const [status, setStatus] = useState("");
    const [lastSaid, setLastSaid] = useState<string>();
    useEffect(() => {
      setDraft(undefined);
      setStatus("");
      void read.said(info.id, { limit: 1 }).then((p) => setLastSaid(p.items[0]?.text));
    }, [info.id]);
    if (info.source && editable && saved !== undefined) {
      const text = draft ?? saved;
      const save = async () => {
        setStatus("saving…");
        const out = await invoke.invoke({
          action: EDIT,
          input: { node: info.source!, words: text },
          authority: { of: "human", basis: "edited in the harness view" },
          reason: `Changed what ${info.title} says`,
        });
        if (out.ok) {
          setDraft(undefined);
          setStatus(`saved (${out.change ?? "no change"})`);
        } else setStatus(`refused: ${out.refused.message}`);
      };
      return html`
        <div class="hv-words">
          <textarea value=${text} onInput=${(e: Event) => setDraft((e.target as HTMLTextAreaElement).value)}></textarea>
          <div class="bar">
            <button class="hv-btn" disabled=${draft === undefined || draft === saved} onClick=${save} title="The next say uses it">Save</button>
            ${draft !== undefined && draft !== saved && html`<button class="hv-btn" onClick=${() => setDraft(undefined)}>Revert</button>`}
            <span class="hv-cut" title=${status}>${status}</span>
          </div>
        </div>
      `;
    }
    return html`
      <div class="hv-words">
        <div class="ro" title=${info.source ? "Nothing provides words.set: read only" : "Its pack's code: what it last said"}>${lastSaid ?? "never said"}</div>
      </div>
    `;
  };

  const Trial = ({ info }: { info: NodeInfo }) => {
    const item = hk.useItem(info.source);
    const canRetire = hk.useHas(RETIRE) && !hk.useHas("keep.apply");
    const [status, setStatus] = useState("");
    useEffect(() => setStatus(""), [info.id]);
    if (item?.fields.status !== "trial") return null;
    const from = typeof item.fields.from_run === "string" ? item.fields.from_run : undefined;
    const seq = item.fields.from_seq;
    const retire = async () => {
      setStatus("retiring…");
      const out = await invoke.invoke({
        action: RETIRE,
        input: { node: info.source! },
        authority: { of: "human", basis: "retired in the harness view" },
        reason: `Retired the trial node ${info.title}`,
      });
      setStatus(out.ok ? "retired" : `refused: ${out.refused.message}`);
    };
    return html`
      <div class="hv-group">trial · after this miss</div>
      <div class="hv-miss">${typeof item.fields.misses === "string" ? item.fields.misses : "—"}</div>
      ${from && html`<div class="hv-row" onClick=${() => set.set(KEYS.run, from)} title="Show that run"><span class="x">from ${from.slice(0, 8)}${seq !== undefined ? ` #${seq}` : ""}</span></div>`}
      ${canRetire && html`<div class="hv-words"><div class="bar">
        <button class="hv-btn" onClick=${retire}>Retire</button>
        <span>${status}</span>
      </div></div>`}
    `;
  };

  /** A node the map writes a file from (packs/written): the file, and whether it may be refined here. */
  const Written = ({ info }: { info: NodeInfo }) => {
    const item = hk.useItem(info.source);
    const canRule = hk.useHas(RULE);
    const [status, setStatus] = useState("");
    useEffect(() => setStatus(""), [info.id]);
    if (typeof item?.fields.file !== "string") return null;
    const held = typeof item.fields.held === "string" ? item.fields.held : undefined;
    const flip = async () => {
      setStatus("…");
      const out = await invoke.invoke({
        action: RULE,
        input: held ? { node: info.source!, refine: "open" } : { node: info.source!, refine: "held", why: "Held as written in the harness view." },
        authority: { of: "human", basis: "set in the harness view" },
        reason: held ? `Opened ${info.title} to refinement inside the map` : `Held ${info.title} as written`,
      });
      setStatus(out.ok ? "" : `refused: ${out.refused.message}`);
    };
    return html`
      <div class="hv-group">written</div>
      <div class="hv-kv"><span class="k">file</span><span class="v" title=${item.fields.file}>${item.fields.file}</span></div>
      <div class="hv-kv"><span class="k">rule</span><span class="v" title=${held ?? "The loop or an agent may refine it"}>${held ? `held: ${held}` : "open"}</span></div>
      ${canRule && html`<div class="hv-words"><div class="bar">
        <button class="hv-btn" onClick=${flip}>${held ? "Open to refinement" : "Hold as written"}</button>
        <span class="hv-cut" title=${status}>${status}</span>
      </div></div>`}
    `;
  };

  const Pane = ({ nodes, review }: { nodes: NodeInfo[]; review?: Review }) => {
    const id = hk.useHere<string>(KEYS.node);
    const run = hk.useHere<string>(KEYS.run);
    const editable = hk.useHas(EDIT);
    const info = nodes.find((n) => n.id === id);
    const record = hk.useVerdictData(() => (id ? verdicts.record(id) : Promise.resolve(undefined)), [id]);
    const list = hk.useVerdictData(() => (id ? verdicts.verdicts(id, { limit: 30 }).then((p) => p.items) : Promise.resolve([])), [id]);
    if (!id) return html`<div class="hv-pane"><div class="hv-head"><span class="t">Node</span></div><div class="hv-empty">Pick a node.</div></div>`;
    return html`
      <div class="hv-pane">
        <div class="hv-head"><span class="t hv-cut" title=${info?.title ?? id}>${info?.title ?? id}</span></div>
        <div class="hv-body">
          ${!info && html`<div class="hv-empty" title="Not loaded now: its record stays">not loaded</div>`}
          ${info && html`<${Words} info=${info} editable=${editable} />`}
          ${info?.source && html`<${Trial} info=${info} />`}
          <${kp.Standing} review=${review} id=${id} source=${info?.source} />
          ${info?.source && html`<${Written} info=${info} />`}
          ${info && html`
            <div class="hv-kv"><span class="k">places</span><span class="v" title=${info.at.join(", ")}>${info.at.join(", ") || "—"}</span></div>
            <div class="hv-kv"><span class="k">pack</span><span class="v">${info.pack}</span></div>
            <div class="hv-kv"><span class="k">kind</span><span class="v">${info.kind}</span></div>
          `}
          <div class="hv-kv"><span class="k">record</span><span class="v">
            ${record
              ? html`${record.said} in ${record.runs} · <span class="m-held">${mark("held")} ${record.held}</span> <span class="m-failed">${mark("failed")} ${record.failed}</span> <span class="m-quiet">${mark("quiet")} ${record.quiet}</span>`
              : "never said"}
          </span></div>
          <div class="hv-kv"><span class="k">last</span><span class="v">${record?.last ? new Date(record.last).toLocaleString() : "—"}</span></div>
          ${!!list?.length && html`<div class="hv-group">runs</div>`}
          ${(list ?? []).map(
            (x) => html`
              <div class=${`hv-row ${run === x.run ? "hv-lit" : ""}`} onClick=${() => set.set(KEYS.run, x.run)} title=${`failed by #${x.failed_by.join(", #") || "nothing"}`}>
                <${Mark} v=${x.verdict} /><span class="x">${x.run.slice(0, 8)} · ${x.said}</span><span class="n">${clock(x.said_at)}</span>
              </div>
            `,
          )}
        </div>
      </div>
    `;
  };

  return { Pane };
}
