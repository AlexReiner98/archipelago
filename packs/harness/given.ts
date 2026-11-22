/**
 * What the harness gave an agent, beside what the map says: read-only nodes
 * from a transcript pack's `transcript.given` (packs/transcript), hung into
 * each agent's tree at their places, and their text in the node pane from
 * `transcript.text`. Without that pack the view shows none, and the ⋯
 * menu's toggle is gone.
 *
 * A given node's id is `transcript/<run>#<name>`: one per run, so picking
 * one in an agent's tree picks it there alone. Its kind is `given`, its dot
 * a square, its name plain: you can see it, not edit it.
 */
import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import type { NodeInfo } from "../../spec/agent.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import { PartRow } from "./events.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const GIVEN = "transcript.given";
export const GIVEN_TEXT = "transcript.text";
/** A given node's kind. */
export const KIND = "given";
const PACK = "transcript";
/** How long a run's nodes are kept before they are read again, as it goes on. */
const AGAIN_MS = 4000;

/** What `transcript.given` lists. */
export interface GivenRow {
  name: string;
  title: string;
  by: string;
  at: string;
  count: number;
  size: number;
}

/** A given node: a node of the tree, with who said it. */
export interface GivenInfo extends NodeInfo {
  by: string;
  count: number;
  size: number;
}

export const givenId = (run: string, name: string) => `${PACK}/${run}#${name}`;

/** The run and name a given node's id holds, or nothing: not a given node. */
export function parseGiven(id: string | undefined): { run: string; name: string } | undefined {
  if (!id?.startsWith(`${PACK}/`)) return undefined;
  const rest = id.slice(PACK.length + 1);
  const hash = rest.indexOf("#");
  return hash > 0 ? { run: rest.slice(0, hash), name: rest.slice(hash + 1) } : undefined;
}

export const isGiven = (n: NodeInfo | undefined): n is GivenInfo => n?.kind === KIND && n.pack === PACK;

/**
 * Each row as a node of the run's tree. Its name says who said it, except a
 * tool's definition: the tool's bough says whose it is (the MCP server's,
 * or the harness's own), and the square dot says it was given.
 */
export function givenNodes(run: string, rows: GivenRow[]): GivenInfo[] {
  return rows.map((r) => ({
    id: givenId(run, r.name),
    name: `${run}#${r.name}`,
    pack: PACK,
    kind: KIND,
    title: r.name.startsWith("tool:") || r.title.includes(r.by) ? r.title : `${r.title} · ${r.by}`,
    at: [r.at],
    by: r.by,
    count: r.count,
    size: r.size,
  }));
}

/**
 * The given nodes of each run, read through `transcript.given` a page at a
 * time, and again as `tick` moves (the run's events), at most every few
 * seconds. Empty when nothing provides the action, or `on` is false.
 */
export function useGiven(invoke: ActionInvoke, has: boolean, on: boolean, runs: string[], tick: unknown): Map<string, GivenInfo[]> {
  const [got, setGot] = useState<Map<string, GivenInfo[]>>(new Map());
  const last = useRef(new Map<string, number>());
  const key = runs.join(",");
  useEffect(() => {
    if (!has || !on || !runs.length) return;
    let gone = false;
    const read = async (run: string) => {
      const rows: GivenRow[] = [];
      let after: string | undefined;
      for (let i = 0; i < 20; i++) {
        const out = await invoke.invoke({
          action: GIVEN,
          input: { run, limit: LIMIT_MAX, ...(after ? { after } : {}) },
          authority: { of: "human", basis: "read in the sensory interface" },
          reason: "Show what the harness gave the agent",
        });
        if (!out.ok) return undefined;
        const o = out.output as { nodes?: GivenRow[]; next?: string; reading?: boolean };
        rows.push(...(o.nodes ?? []));
        if (!o.next) return { rows, reading: !!o.reading };
        after = o.next;
      }
      return { rows, reading: false };
    };
    const load = async () => {
      for (const run of runs) {
        const at = last.current.get(run) ?? 0;
        if (Date.now() - at < AGAIN_MS) continue;
        last.current.set(run, Date.now());
        const r = await read(run);
        if (gone || !r) continue;
        setGot((m) => new Map(m).set(run, givenNodes(run, r.rows)));
        // Still reading a long transcript: go on soon.
        if (r.reading) setTimeout(() => !gone && (last.current.set(run, 0), void load()), 300);
      }
    };
    const timer = setTimeout(() => void load(), 0);
    return () => {
      gone = true;
      clearTimeout(timer);
    };
  }, [has, on, key, tick]);
  return has && on ? got : new Map();
}

/** The node pane for a given node: who said it, where, and its text, read only. */
export function GivenPane({ invoke, id, info }: { invoke: ActionInvoke; id: string; info?: GivenInfo }) {
  const at = parseGiven(id);
  const [text, setText] = useState<{ text?: string; error?: string; cut?: boolean }>({});
  useEffect(() => {
    setText({});
    if (!at) return;
    let gone = false;
    void invoke
      .invoke({ action: GIVEN_TEXT, input: { run: at.run, name: at.name }, authority: { of: "human", basis: "read in the sensory interface" }, reason: "Read what the harness gave the agent" })
      .then((out) => {
        if (gone) return;
        if (out.ok) {
          const o = out.output as { text?: string; cut?: boolean };
          setText({ text: o.text ?? "", ...(o.cut ? { cut: true } : {}) });
        } else setText({ error: out.refused.message });
      });
    return () => {
      gone = true;
    };
  }, [id]);
  const title = info?.title ?? at?.name ?? id;
  return html`
    <div class="hv-pane">
      <div class="hv-head"><span class="t hv-cut" title=${title}>${title}</span><span class="sp"></span><span class="hv-dim" title="Given by the harness, read from the run's transcript: you can see it, not edit it">read only</span></div>
      <div class="hv-body">
        <div class="hv-kv"><span class="k">by</span><span class="v">${info?.by ?? "—"}</span></div>
        <div class="hv-kv"><span class="k">place</span><span class="v">${info?.at.join(", ") ?? "—"}</span></div>
        <div class="hv-kv"><span class="k">given</span><span class="v">${info ? `${info.count} time${info.count === 1 ? "" : "s"} · ${info.size.toLocaleString()} letters` : "—"}</span></div>
        <div class="hv-given">
          ${text.error ? html`<div class="hv-empty">Not read: ${text.error}</div>` : text.text === undefined ? html`<div class="hv-empty">reading…</div>` : html`<${PartRow} p=${{ label: text.cut ? "text, cut: the rest is in the transcript" : "text", text: text.text || "empty" }} />`}
        </div>
      </div>
    </div>`;
}
