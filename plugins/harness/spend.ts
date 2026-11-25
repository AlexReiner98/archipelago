/**
 * A run's spend against its task's estimate, read through `budget.spend`
 * (the budget plugin's), for the runs shown: a mark on each run's row and on
 * the run pane's head. Nothing shows when nothing provides the action, or
 * the run's task has no estimate.
 */
import { h } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import htm from "htm";
import type { ActionInvoke } from "../../spec/action.ts";
import { sheet } from "../../spec/style.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export const SPEND = "budget.spend";
/** The most runs one read asks for (the action's own cap). */
const RUNS_MAX = 50;
/** The fewest milliseconds between two reads of the same runs as events come. */
const EVERY = 5000;

export interface Spend {
  run: string;
  spent: number;
  task?: string;
  estimate?: number;
  ratio: number;
  over: boolean;
  asked: boolean;
  none?: boolean;
}

export const tok = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

/** Where spend stands: under the estimate, past it, or past the ratio it is asked at. */
export type Level = "under" | "past" | "over";
export const levelOf = (s: Spend): Level | undefined => (!s.estimate ? undefined : s.over ? "over" : s.spent > s.estimate ? "past" : "under");

export const spendTip = (s: Spend) =>
  !s.estimate
    ? ""
    : [
        `${tok(s.spent)} tokens spent of ${tok(s.estimate)} estimated (${Math.round((s.spent / s.estimate) * 100)}%)`,
        "Measured: input, cache writes and output, not cached re-reads",
        `Asked once past ${s.ratio}× (${tok(s.estimate * s.ratio)})${s.asked ? ": asked" : ""}`,
      ].join("\n");

export const SPEND_STYLE = sheet(`
.hv-spend { font-variant-numeric:tabular-nums; color:var(--dim); white-space:nowrap; flex:none; }
.hv-spend.past { color:var(--fg); }
.hv-spend.over { color:var(--failed); }
.hv-spend .q { margin-left:var(--space-1); }
`);

/** The mark: spent / estimate, coloured by where it stands, ⊘ once asked (the refusal's mark in the run). */
export const SpendMark = ({ s }: { s?: Spend }) => {
  const level = s && levelOf(s);
  if (!s || !level) return null;
  return html`<span class=${`hv-spend ${level}`} title=${spendTip(s)}>${tok(s.spent)} / ${tok(s.estimate!)}${s.asked ? html`<span class="q">⊘</span>` : ""}</span>`;
};

/** Each run's spend, read again as `tick` moves (at most every few seconds). Empty when nothing provides the action. */
export function useSpend(invoke: ActionInvoke, has: boolean, runs: string[], tick: unknown): Map<string, Spend> {
  const [got, setGot] = useState<Map<string, Spend>>(new Map());
  const last = useRef(0);
  const key = runs.slice(0, RUNS_MAX).join(",");
  useEffect(() => {
    if (!has || !key) return;
    let gone = false;
    const load = async () => {
      last.current = Date.now();
      const out = await invoke.invoke({
        action: SPEND,
        input: { runs: key.split(",") },
        authority: { of: "human", basis: "read in the context interface" },
        reason: "Show runs' spend against their estimates",
      });
      if (gone || !out.ok) return;
      const list = ((out.output as { runs?: Spend[] }).runs ?? []) as Spend[];
      setGot(new Map(list.map((s) => [s.run, s])));
    };
    const wait = Math.max(0, last.current + EVERY - Date.now());
    const t = setTimeout(() => void load(), wait);
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [has, key, tick]);
  return got;
}
