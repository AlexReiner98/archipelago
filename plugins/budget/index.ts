/**
 * The budget plugin: a run past its estimate is asked once.
 *
 * - Spend: the run's measured tokens, summed from the transcript's usage
 *   rows (`transcript.tokens`): input, cache writes and output, not cached
 *   re-reads, as the work base's `tokens_estimated` counts them.
 * - Estimate: the `tokens_estimated` of the run's task (its `task`).
 * - Ratio: the first context filter the run is in that sets `budget_ratio`, else the
 *   plugin's config `ratio`, else RATIO (1.5).
 * - Ask: its node `budget/ask` refuses at `reply_end` with the code `ask`,
 *   once spend passes estimate × ratio, so the agent keeps going and hears
 *   why. Once per run: a refusal of its own in the run's events (across
 *   restarts) keeps it quiet. The verdict plugin doesn't count an asking
 *   refusal as a miss.
 * - Show: the read-only action `budget.spend` ({ runs }) answers each run's
 *   spend, estimate, ratio, and whether it was asked: the harness's run
 *   rows show it.
 *
 * Injects exchange.read, agent.node, action.register, action.list,
 * action.invoke, graph.read and profile.read.
 */
import type { ActionInvoke, ActionList, ActionRegister } from "../../spec/action.ts";
import type { AgentNode, RunId, RunInfo } from "../../spec/agent.ts";
import type { Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { ExchangeRead } from "../../spec/exchange.ts";
import type { GraphRead } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { ProfileRead } from "../../spec/profile.ts";
import type { Context, Plugin } from "../../runtime/core.ts";

export const ASKER = "budget/ask";
export const SPEND = "budget.spend";
/** The refusal's code: an ask, not a miss (as the grow plugin's). */
export const ASK = "ask";
/** The default ratio of spend to estimate past which a run is asked. */
export const RATIO = 1.5;
/** The context filter field that sets the ratio for its runs. */
export const FIELD = "budget_ratio";
/** The most pages of usage or events one read goes through. */
export const PAGES = 64;
/** The most runs one `budget.spend` answers. */
export const RUNS_MAX = 50;

export interface BudgetConfig {
  /** Spend over estimate past which a run is asked; default RATIO. */
  ratio?: number;
}

/** What a usage row counts toward spend: what `tokens_estimated` counts. */
export interface UsageRow {
  input?: number;
  cacheWrite?: number;
  output?: number;
}
export const spentOf = (rows: readonly UsageRow[]) => rows.reduce((s, r) => s + (r.input ?? 0) + (r.cacheWrite ?? 0) + (r.output ?? 0), 0);

/** A token count to read: 12k, 1.2M. */
export const tok = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${+(n / 1e3).toFixed(1)}k` : String(Math.round(n)));

export const ASK_WORDS =
  "Before you finish: this run has spent {spent} tokens, {times}× its task's estimate of {estimate} ({task}), past the {ratio}× this run is asked at. Say in one line why it ran over and whether the rest is worth it; if the estimate was wrong, set the task's tokens_estimated. You are asked once in this run.";

export function askText(s: { spent: number; estimate: number; ratio: number; task: Id }): string {
  const vars: Record<string, string> = { spent: tok(s.spent), estimate: tok(s.estimate), times: (s.spent / s.estimate).toFixed(1), ratio: String(s.ratio), task: s.task };
  return ASK_WORDS.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

const ratioOk = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0;
const refuse = (code: string, message: string) => new Refused({ code, message, by: { plugin: "budget" } });

/** One run's spend against its estimate. */
export interface Spend {
  run: RunId;
  spent: number;
  task?: Id;
  estimate?: number;
  ratio: number;
  /** Spend past estimate × ratio. */
  over: boolean;
  /** Its node asked in the run. */
  asked: boolean;
  /** No transcript read for the run: spend unknown. */
  none?: boolean;
}

const budget: Plugin<BudgetConfig> = {
  id: "budget",
  about: "Asks a run once when its tokens pass its task's estimate by a ratio, and shows spend against estimate.",
  inject: ["exchange.read", "agent.node", "action.register", "action.list", "action.invoke", "graph.read", "profile.read"],
  apply(ctx: Context, config: BudgetConfig = {}) {
    const read = ctx.get<ExchangeRead>("exchange.read");
    const graph = ctx.get<GraphRead>("graph.read");
    const profiles = ctx.get<ProfileRead>("profile.read");
    const actions = ctx.get<ActionList>("action.list");
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    const base = ratioOk(config.ratio) ? config.ratio : RATIO;

    /** The run's measured tokens; undefined when nothing reads transcripts. */
    const spent = async (run: RunId): Promise<{ spent: number; none: boolean } | undefined> => {
      if (!actions.list().some((a) => a.name === "transcript.tokens")) return undefined;
      const rows: UsageRow[] = [];
      let none = false;
      let after: number | undefined;
      for (let i = 0; i < PAGES; i++) {
        const out = await invoke.invoke<Record<string, Json>>({
          action: "transcript.tokens",
          input: { run, kind: "usage", limit: LIMIT_MAX, ...(after !== undefined ? { after } : {}) },
          authority: { of: "agent", basis: "the budget plugin reads a run's spend" },
          reason: "Read a run's token use",
        });
        if (!out.ok) return undefined;
        none = !!out.output.none;
        rows.push(...((out.output.rows as UsageRow[] | undefined) ?? []));
        if (typeof out.output.next !== "number") break;
        after = out.output.next;
      }
      return { spent: spentOf(rows), none };
    };

    const taskOf = (run: RunInfo): Id | undefined => {
      const t = run.facts?.task;
      return typeof t === "string" && t ? t : run.task;
    };

    const estimateOf = async (task: Id | undefined) => {
      if (!task) return undefined;
      const [item] = await graph.get([task]);
      const e = item?.fields.tokens_estimated;
      return typeof e === "number" && e > 0 ? e : undefined;
    };

    const ratioOf = async (run: RunInfo) => {
      const ps = await profiles.of(run);
      for (let i = 0; i < ps.length; i += LIMIT_MAX) {
        for (const item of await graph.get(ps.slice(i, i + LIMIT_MAX).map((p) => p.id))) {
          if (item && ratioOk(item.fields[FIELD])) return item.fields[FIELD] as number;
        }
      }
      return base;
    };

    const askedIn = async (run: RunId) => {
      let after: string | undefined;
      for (let i = 0; i < PAGES; i++) {
        const page = await read.events(run, { limit: LIMIT_MAX, ...(after ? { after } : {}) });
        if (page.items.some((e) => e.kind === "refuse" && e.node === ASKER)) return true;
        if (!page.next) return false;
        after = page.next;
      }
      return false;
    };

    const spendOf = async (run: RunInfo): Promise<Spend> => {
      const task = taskOf(run);
      const [s, estimate, ratio, asked] = await Promise.all([spent(run.run), estimateOf(task), ratioOf(run), askedIn(run.run)]);
      const n = s?.spent ?? 0;
      return {
        run: run.run,
        spent: n,
        ...(task ? { task } : {}),
        ...(estimate ? { estimate } : {}),
        ratio,
        over: !!estimate && n > estimate * ratio,
        asked,
        ...(!s || s.none ? { none: true } : {}),
      };
    };

    ctx.get<AgentNode>("agent.node").node({
      name: "ask",
      kind: "reflex",
      title: "A run past its estimate is asked once",
      at: ["reply_end"],
      async speak(moment, run) {
        const task = taskOf(run);
        const estimate = await estimateOf(task);
        if (!task || !estimate) return null;
        const s = await spent(moment.run);
        if (!s) return null;
        const ratio = await ratioOf(run);
        if (s.spent <= estimate * ratio) return null;
        if (await askedIn(moment.run)) return null;
        return { refuse: askText({ spent: s.spent, estimate, ratio, task }), code: ASK };
      },
    });

    ctx.get<ActionRegister>("action.register").register({
      name: SPEND,
      title: "A run's spend against its task's estimate",
      doc: `For each run (at most ${RUNS_MAX}): spent (measured tokens: input, cache writes, output, not cached re-reads), its task and the task's tokens_estimated, the ratio it is asked at (a context filter's ${FIELD}, else the config's, else ${RATIO}), over, asked (the ask came), none (no transcript read). Writes nothing.`,
      input: {
        type: "object",
        properties: { runs: { type: "array", items: { type: "string" }, description: `Run ids, at most ${RUNS_MAX}` } },
        required: ["runs"],
      },
      async run(input: { runs: string[] }) {
        const ids = Array.isArray(input.runs) ? [...new Set(input.runs.filter((r) => typeof r === "string" && r))] : [];
        if (!ids.length) throw refuse("budget.runs", "Say which runs.");
        if (ids.length > RUNS_MAX) throw refuse("budget.runs", `At most ${RUNS_MAX} runs at once.`);
        // Each run's info: from the runs list, newest first, a bounded number of pages.
        const want = new Set(ids);
        const infos = new Map<string, RunInfo>();
        let after: string | undefined;
        for (let i = 0; i < PAGES && infos.size < want.size; i++) {
          const page = await read.runs({ limit: LIMIT_MAX, ...(after ? { after } : {}) });
          for (const r of page.items) if (want.has(r.run)) infos.set(r.run, r);
          if (!page.next) break;
          after = page.next;
        }
        const runs = await Promise.all(ids.filter((r) => infos.has(r)).map((r) => spendOf(infos.get(r)!)));
        return { runs: runs as unknown as Json };
      },
    });
  },
};

export default budget;
