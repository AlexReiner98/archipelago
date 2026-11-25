/**
 * The lean plugin: what a profile leaves out of Claude Code's context. From
 * the used plugin's count over a profile's runs (`used.tools` with
 * `profile`), each MCP server and tool none of them used is what it would
 * leave out (plan.ts): computed and shown always, whatever the profile's
 * status. Nothing is written here.
 *
 * - `lean.plan` ({ profile?, run? }): the plan of one profile, of each
 *   profile a run is in, or of every profile not off. Read only.
 * - `lean.set` ({ profile, leave? }): records what the profile leaves out,
 *   on its `leave_out` field (the profile plugin's), as a change set:
 *   `history.undo` takes it back. No `leave`: the plan as it is now. An
 *   empty list: nothing left out.
 * - Writing it into the settings Claude Code reads is the writer's
 *   (write.ts), loaded only when the server writes, and only for profiles
 *   that are on.
 *
 * Injects graph.read for the profiles, exchange.read and profile.read for a
 * run's profiles, action.register.
 */
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import type { RunInfo } from "../../spec/agent.ts";
import type { Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { ExchangeRead } from "../../spec/exchange.ts";
import type { GraphRead, Item } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { ProfileRead } from "../../spec/profile.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import type { UseRow } from "../used/tally.ts";
import { kept, leaveOut, MIN_RUNS } from "./plan.ts";

export const PLAN = "lean.plan";
export const SET = "lean.set";
export const USED = "used.tools";
export const TYPE = "context_filter";
export const FIELD = "leave_out";
/** The most profiles one plan reads. */
export const PROFILES_MAX = LIMIT_MAX;

const refuse = (code: string, message: string) => new Refused({ code, message, by: { plugin: "lean" } });

/** What a profile's `leave_out` holds: names, or nothing. */
export const setOf = (it: Item | undefined): string[] => (Array.isArray(it?.fields[FIELD]) ? (it!.fields[FIELD] as Json[]).filter((x): x is string => typeof x === "string") : []);

export interface Plan {
  profile: Id;
  title: string;
  state: string;
  /** Runs of the profile counted. */
  runs: number;
  /** Enough runs to say anything. */
  enough: boolean;
  leave: { name: string; given: number; size: number }[];
  /** Letters left out in all. */
  letters: number;
  /** What `leave_out` holds now: what the writer writes, when the profile is on. */
  set: string[];
}

const lean: Plugin = {
  id: "lean",
  about: "What a profile leaves out of Claude Code's context: the tools and MCP servers its runs never use.",
  inject: ["graph.read", "exchange.read", "profile.read", "action.register"],
  apply(ctx: Context) {
    const graph = ctx.get<GraphRead>("graph.read");
    const exchange = ctx.get<ExchangeRead>("exchange.read");
    const profiles = ctx.get<ProfileRead>("profile.read");

    const planOf = async (it: Item, call: ActionContext): Promise<Plan> => {
      const rows: UseRow[] = [];
      let runs = 0;
      let after: string | undefined;
      for (let i = 0; i < 20; i++) {
        const out = (await call.call(USED, { profile: it.id, limit: LIMIT_MAX, ...(after ? { after } : {}) })) as unknown as { runs: number; tools: UseRow[]; next?: string };
        runs = out.runs;
        rows.push(...out.tools);
        if (!out.next) break;
        after = out.next;
      }
      const leave = leaveOut(rows, runs);
      return {
        profile: it.id,
        title: String(it.fields.title ?? it.id),
        state: String(it.fields.status ?? "shadow"),
        runs,
        enough: runs >= MIN_RUNS,
        leave,
        letters: leave.reduce((n, l) => n + l.size, 0),
        set: setOf(it),
      };
    };

    const runInfo = async (run: string): Promise<RunInfo | undefined> => {
      let after: string | undefined;
      for (let p = 0; p < 20; p++) {
        const page = await exchange.runs({ limit: LIMIT_MAX, ...(after ? { after } : {}) });
        const r = page.items.find((x) => x.run === run);
        if (r) return r;
        if (!page.next) return undefined;
        after = page.next;
      }
      return undefined;
    };

    const reg = ctx.get<ActionRegister>("action.register");
    reg.register({
      name: PLAN,
      title: "What a profile would leave out of Claude Code's context",
      doc: "Per profile: the MCP servers and tools none of its runs used (never the always-kept ones), their letters, and what it has set to leave out. Read only.",
      input: { type: "object", properties: { profile: { type: "string" }, run: { type: "string", description: "Each profile this run is in" } } },
      async run(input: { profile?: Id; run?: string }, call: ActionContext) {
        let items: Item[];
        if (input.profile) items = (await graph.get([input.profile])).filter((i): i is Item => !!i && i.type === TYPE);
        else if (input.run) {
          const r = await runInfo(input.run);
          const ids = r ? (await profiles.of(r)).map((p) => p.id) : [];
          items = ids.length ? (await graph.get(ids.slice(0, LIMIT_MAX))).filter((i): i is Item => !!i) : [];
        } else items = (await graph.of(TYPE, { limit: PROFILES_MAX })).items;
        items = items.filter((i) => i.fields.status !== "off");
        const plans: Plan[] = [];
        for (const it of items) plans.push(await planOf(it, call));
        return { plans: plans as unknown as Json };
      },
    });

    reg.register({
      name: SET,
      title: "Record what a profile leaves out of Claude Code's context",
      doc: "Sets the profile's leave_out: the plan as it is now, or the names given (tool:<name>, mcp:<server>); an empty list leaves nothing out. Written into the settings of its runs' project folders only while the profile is on and the server writes. Undo with history.undo.",
      input: {
        type: "object",
        properties: { profile: { type: "string" }, leave: { type: "array", items: { type: "string" } } },
        required: ["profile"],
      },
      async run(input: { profile: Id; leave?: string[] }, call: ActionContext) {
        const [it] = await graph.get([input.profile]);
        if (!it || it.type !== TYPE) throw refuse("lean.not_a_profile", `${input.profile} is not a profile.`);
        let names: string[];
        if (input.leave === undefined) {
          const plan = await planOf(it, call);
          if (!plan.enough) throw refuse("lean.few_runs", `${plan.title} has ${plan.runs} run${plan.runs === 1 ? "" : "s"} counted; it needs ${MIN_RUNS} before anything is left out.`);
          names = plan.leave.map((l) => l.name);
        } else {
          if (!Array.isArray(input.leave) || input.leave.length > LIMIT_MAX) throw refuse("lean.leave", `leave is a list of at most ${LIMIT_MAX} names.`);
          names = [...new Set(input.leave.map(String))];
          for (const n of names) {
            const why = kept(n);
            if (why) throw refuse("lean.kept", why);
          }
        }
        const had = it.fields[FIELD];
        if (JSON.stringify(setOf(it)) === JSON.stringify(names)) return { profile: it.id, leave: names };
        if (had !== undefined) call.write([["-", it.id, FIELD, had]]);
        if (names.length) call.write([["+", it.id, FIELD, names]]);
        return { profile: it.id, leave: names };
      },
    });
  },
};

export default lean;
