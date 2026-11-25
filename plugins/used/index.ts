/**
 * The used plugin: which tools and MCP servers Claude Code gave its runs, and
 * which they used, across runs (tally.ts). Given: a run's `tool:<name>` and
 * `mcp:<server>` nodes from the transcript plugin's `transcript.given`, with
 * their size. Used: the run's tool acts on the exchange (`act`, kind `tool`,
 * at `tool:<name>`).
 *
 * - The window: the newest WINDOW runs that have a transcript, read a page
 *   at a time (LIMIT_MAX), at most RUN_PAGES pages of runs.
 * - Kept in memory per run: an ended run read to its end is not read again;
 *   a live one at most every AGAIN_MS, its events from where it left off.
 * - One read-only action, `used.tools` ({ names?, profile?, after?, limit? }).
 *
 * Injects exchange.read for the runs and their acts, profile.read to count
 * only a profile's runs, action.register; it calls `transcript.given` from
 * inside its action.
 */
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import type { RunInfo } from "../../spec/agent.ts";
import type { Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { ExchangeRead } from "../../spec/exchange.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { ProfileRead } from "../../spec/profile.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { counted, tally, type RunUse } from "./tally.ts";

export const TOOLS = "used.tools";
export const GIVEN = "transcript.given";
/** How many runs with a transcript are counted: the newest. */
export const WINDOW = 50;
/** The most pages of runs read to find them. */
export const RUN_PAGES = 20;
/** The most pages of one run's events read in one call. */
export const EVENT_PAGES = 50;
/** How long a live run's count is kept before it is read again. */
export const AGAIN_MS = 5000;

const refuse = (code: string, message: string) => new Refused({ code, message, by: { plugin: "used" } });

const hasTranscript = (r: RunInfo) => {
  const t = r.facts?.transcript;
  return typeof (Array.isArray(t) ? t[0] : t) === "string";
};

interface Kept {
  use: RunUse;
  /** Read to its end, and the run ended: never read again. */
  final: boolean;
  at: number;
  after?: string;
}

const used: Plugin = {
  id: "used",
  about: "Which given tools and MCP servers runs used, across runs, and their size.",
  inject: ["exchange.read", "profile.read", "action.register"],
  apply(ctx: Context) {
    const exchange = ctx.get<ExchangeRead>("exchange.read");
    const profiles = ctx.get<ProfileRead>("profile.read");
    const kept = new Map<string, Kept>();

    /** The newest runs that have a transcript, at most WINDOW. */
    const windowRuns = async (): Promise<RunInfo[]> => {
      const out: RunInfo[] = [];
      let after: string | undefined;
      for (let p = 0; p < RUN_PAGES && out.length < WINDOW; p++) {
        const page = await exchange.runs({ limit: LIMIT_MAX, ...(after ? { after } : {}) });
        for (const r of page.items) if (hasTranscript(r) && out.length < WINDOW) out.push(r);
        if (!page.next) break;
        after = page.next;
      }
      return out;
    };

    /** One run's use: its given tools from the transcript, its tool acts from where the last read stopped. */
    const useOf = async (r: RunInfo, call: ActionContext): Promise<{ use: RunUse; reading: boolean }> => {
      const had = kept.get(r.run);
      if (had && (had.final || Date.now() - had.at < AGAIN_MS)) return { use: had.use, reading: !had.final && !r.ended };
      const given = new Map<string, number>();
      let reading = false;
      let after: string | undefined;
      for (let i = 0; i < 20; i++) {
        const out = (await call.call(GIVEN, { run: r.run, limit: LIMIT_MAX, ...(after ? { after } : {}) })) as { nodes?: { name: string; size: number }[]; next?: string; reading?: boolean };
        for (const n of out.nodes ?? []) if (counted(n.name)) given.set(n.name, n.size);
        if (out.reading) reading = true;
        if (!out.next) break;
        after = out.next;
      }
      const usedSet = had?.use.used ?? new Set<string>();
      let cursor = had?.after;
      let more = false;
      for (let p = 0; p < EVENT_PAGES; p++) {
        const page = await exchange.events(r.run, { limit: LIMIT_MAX, ...(cursor ? { after: cursor } : {}) });
        for (const e of page.items) {
          if (e.kind === "act" && e.act?.kind === "tool" && e.place?.startsWith("tool:")) usedSet.add(e.place.slice(5));
        }
        if (page.next) cursor = page.next;
        more = !!page.next;
        if (!page.next) break;
      }
      const use = { run: r.run, given, used: usedSet };
      kept.set(r.run, { use, final: !!r.ended && !reading && !more, at: Date.now(), ...(cursor ? { after: cursor } : {}) });
      return { use, reading: reading || more };
    };

    let busy: Promise<unknown> = Promise.resolve();
    const reg = ctx.get<ActionRegister>("action.register");
    reg.register({
      name: TOOLS,
      title: "Which given tools and MCP servers runs used, across runs",
      doc: "Per tool (tool:<name>) and MCP server (mcp:<server>): in how many of the newest runs with a transcript it was given, in how many used, and its size in letters. With profile, only that profile's runs. Writes nothing.",
      input: {
        type: "object",
        properties: {
          names: { type: "array", items: { type: "string" }, description: "Only these rows (tool:<name>, mcp:<server>)" },
          profile: { type: "string", description: "Only runs in this profile" },
          after: { type: "string", description: "The last name of the page before" },
          limit: { type: "number" },
        },
      },
      async run(input: { names?: string[]; profile?: Id; after?: string; limit?: number }, call: ActionContext) {
        if (input.names && (!Array.isArray(input.names) || input.names.length > LIMIT_MAX)) throw refuse("used.names", `names is a list of at most ${LIMIT_MAX}.`);
        const work = busy.then(async () => {
          let runs = await windowRuns();
          if (input.profile) {
            const ins = await Promise.all(runs.map(async (r) => (await profiles.of(r)).some((p) => p.id === input.profile)));
            runs = runs.filter((_, i) => ins[i]);
          }
          let reading = false;
          const uses: RunUse[] = [];
          for (const r of runs) {
            const u = await useOf(r, call);
            uses.push(u.use);
            if (u.reading) reading = true;
          }
          return { runs: runs.length, rows: tally(uses), reading };
        });
        busy = work.catch(() => undefined);
        const { runs, rows, reading } = await work;
        const want = input.names ? new Set(input.names) : undefined;
        const from = rows.filter((r) => (!want || want.has(r.name)) && (!input.after || r.name > input.after));
        const limit = Math.max(1, Math.min(LIMIT_MAX, Number(input.limit) || LIMIT_MAX));
        const tools = from.slice(0, limit);
        return {
          runs,
          window: WINDOW,
          tools: tools as unknown as Json,
          ...(from.length > limit ? { next: tools[tools.length - 1]!.name } : {}),
          ...(reading ? { reading: true } : {}),
        };
      },
    });
    ctx.effect(() => () => kept.clear());
  },
};

export default used;
