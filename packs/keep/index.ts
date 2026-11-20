/**
 * The keep pack: the learning loop's second half. A trial node (from the
 * grow pack) is promoted or retired by its record, and a node that can't be
 * trusted never reaches a run.
 *
 * - Standing (rule.ts): each trial node's record from `verdict.read` (less
 *   the run it was written in, where its miss came first by design) in, its
 *   standing out: stay on trial, promote (it held often enough) or retire
 *   (failing, idle or a duplicate), with why.
 * - Apply: no human gate. When a standing says promote or retire, the pack
 *   applies it through `keep.apply` (words.promote or words.retire, plus a
 *   `decided` field with the rule, why and the record), as one change set
 *   that `history.undo` takes back. After an undo it doesn't decide that node
 *   again until its record has another run. A person keeps or retires one
 *   the same way, from the harness view.
 * - Gate (`agent.gate`): a node whose map item is held in the schema pack's
 *   quarantine, doesn't fit its type now, or whose words fail their check
 *   (empty, too long, a home folder, a secret) is held back from every run.
 * - Self-edit (a stage on the write chain): a change made in a run to a node
 *   that failed in that same run (its miss came after it was said there) is
 *   refused: a run doesn't quiet its own misses by rewriting, promoting or
 *   retiring what it was told.
 *
 * `keep.review` answers every trial node's record, standing and checks, and
 * the nodes this pack or a person decided: what the harness view shows.
 *
 * Injects verdict.read, agent.tree, agent.gate, graph.read, graph.watch,
 * graph.stage, action.register, action.invoke and action.list.
 */
import type { ActionContext, ActionInvoke, ActionList, ActionRegister } from "../../spec/action.ts";
import type { AgentGate, AgentTree, NodeInfo } from "../../spec/agent.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { GraphRead, GraphStage, GraphWatch, Item } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { DEFAULTS, standing, wordsProblems, type Peer, type Standing, type Tally, type Thresholds } from "./rule.ts";

export { DEFAULTS, overlap, standing, wordsProblems } from "./rule.ts";

const TYPE = "node";
/** The words pack's trial mark: a node's own words never carry it. */
const TRIAL_MARK = "(Trial node, written after a miss: it may be wrong.)";
/** What a run may not change on a node that failed in it. */
const GUARDED = new Set(["words", "status", "at", "when", "refuse", "misses"]);

export interface KeepConfig extends Partial<Thresholds> {
  /** Apply what the record says. Default true; false only shows it. */
  apply?: boolean;
}

/** What `verdict.read` answers here (the verdict pack's own key). */
interface VerdictRead {
  run(run: string): Promise<{ node: string; verdict: string; after: number; failed_by: number[] }[]>;
  record(node: string): Promise<(Tally & { last?: string; places: Record<string, number> }) | undefined>;
  verdicts(node: string, page?: { limit?: number; after?: string }): Promise<{ items: { run: string; verdict: "held" | "failed" | "quiet"; said: number }[]; next?: string }>;
  watch(on: (c: { run?: string }) => void): () => void;
}

/** What `keep.apply` writes on a node it decided. */
export interface Decided {
  state: "promote" | "retire";
  rule?: string;
  why: string;
  by: string;
  at: string;
  /** The node in the tree it was, so its record can be found once it is retired. */
  node?: string;
  record?: Tally;
}

export interface Reviewed {
  /** The node's map item. */
  item: Id;
  /** The node in the tree, while it is loaded. */
  node?: string;
  title: string;
  at: string[];
  status: string;
  record?: Tally & { last?: string };
  standing?: Standing;
  /** Why it is held back from every run; empty when nothing is wrong. */
  checks: string[];
  decided?: Decided;
}

export interface Review {
  thresholds: Thresholds;
  apply: boolean;
  nodes: Reviewed[];
}

const by = { pack: "keep" };
const str = (v: Json | undefined) => (typeof v === "string" ? v : "");
const atOf = (i: Item) => (Array.isArray(i.fields.at) ? (i.fields.at as string[]) : []);
const decidedOf = (i: Item): Decided | undefined => {
  const d = i.fields.decided;
  return d && typeof d === "object" && !Array.isArray(d) && typeof d.state === "string" ? (d as unknown as Decided) : undefined;
};

const keep: Pack<KeepConfig> = {
  id: "keep",
  inject: ["verdict.read", "agent.tree", "agent.gate", "graph.read", "graph.watch", "graph.stage", "action.register", "action.invoke", "action.list"],
  async apply(ctx: Context, config: KeepConfig = {}) {
    const t: Thresholds = {
      promote: config.promote ?? DEFAULTS.promote,
      fail: config.fail ?? DEFAULTS.fail,
      idle: config.idle ?? DEFAULTS.idle,
      same: config.same ?? DEFAULTS.same,
    };
    const applying = config.apply !== false;
    const verdicts = ctx.get<VerdictRead>("verdict.read");
    const tree = ctx.get<AgentTree>("agent.tree");
    const graph = ctx.get<GraphRead>("graph.read");
    const actions = ctx.get<ActionList>("action.list");
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    const has = (name: string) => actions.list().some((a) => a.name === name);

    /** Per item, the runs its record had when this pack last decided it: an undo isn't redone until another run. */
    const decidedAt = new Map<Id, number>();
    // Declared before anything can call soon(): a watch may fire while the pack loads or unloads.
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = Promise.resolve();
    let gone = false;
    ctx.effect(() => () => {
      gone = true;
      clearTimeout(timer);
    });

    /** Every node item, kept live: read page by page, then followed. */
    const items = new Map<Id, Item>();
    const loadNodes = async () => {
      for (let p = await graph.of(TYPE, { limit: LIMIT_MAX }); ; p = await graph.of(TYPE, { limit: LIMIT_MAX, after: p.next })) {
        for (const i of p.items) items.set(i.id, i);
        if (!p.next) break;
      }
    };
    const checked = new Map<Id, { key: string; problems: string[] }>();
    ctx.get<GraphWatch>("graph.watch").watch({ types: [TYPE] }, async (change) => {
      const ids = [...new Set(change.facts.map((f) => f[1]))];
      const now = await graph.get(ids);
      ids.forEach((id, k) => {
        const i = now[k];
        if (i && i.type === TYPE) items.set(id, i);
        else items.delete(id);
        checked.delete(id);
      });
      soon();
    });
    await loadNodes();

    const nodeOf = (item: Id): NodeInfo | undefined => tree.nodes().find((n) => n.source === item);

    // ---------- the checks a node passes before it reaches a run ----------

    /** Held change sets, by the ids their facts name: refreshed at most every few seconds. */
    let held: { at: number; ids: Map<Id, string> } = { at: 0, ids: new Map() };
    const quarantined = async (): Promise<Map<Id, string>> => {
      if (Date.now() - held.at < 5000 || !has("schema.quarantined")) return held.ids;
      const ids = new Map<Id, string>();
      const out = await invoke.invoke<{ items: { id: string; change: { facts: Fact[] }; problems: { id?: string; message: string }[] }[] }>({
        action: "schema.quarantined",
        input: { state: "held", limit: LIMIT_MAX },
        authority: { of: "agent", basis: "the keep pack's quarantine check" },
        reason: "Read which change sets are held",
      });
      if (out.ok) {
        for (const h of out.output.items) {
          for (const f of h.change.facts) if (!ids.has(f[1])) ids.set(f[1], `${h.id}: ${h.problems.map((p) => p.message).join(" ")}`);
        }
      }
      held = { at: Date.now(), ids };
      return ids;
    };

    /** Why an item's node can't be trusted with a run: empty when nothing is wrong. */
    const checksOf = async (item: Item): Promise<string[]> => {
      const key = JSON.stringify(item.fields);
      const had = checked.get(item.id);
      let problems: string[];
      if (had && had.key === key) problems = had.problems;
      else {
        problems = [];
        if (!str(item.fields.voice)) problems.push(...wordsProblems(item.fields.words, TRIAL_MARK).map((p) => `words: ${p}`));
        if (has("schema.check")) {
          const facts: Fact[] = [["+", item.id, "type", item.type], ...Object.entries(item.fields).map(([k, v]) => ["+", item.id, k, v] as Fact)];
          const out = await invoke.invoke<{ fits: boolean; problems: { message: string }[] }>({
            action: "schema.check",
            input: { facts } as unknown as Json,
            authority: { of: "agent", basis: "the keep pack's type check" },
            reason: "Check a node against its type",
          });
          if (out.ok && !out.output.fits) problems.push(`type: ${out.output.problems.map((p) => p.message).join(" ")}`);
        }
        checked.set(item.id, { key, problems });
      }
      const q = (await quarantined()).get(item.id);
      return q ? [...problems, `quarantined as ${q}`] : problems;
    };

    ctx.get<AgentGate>("agent.gate").gate({
      name: "trusted",
      title: "A quarantined node, or one whose words fail their check, never reaches a run",
      async hold(node) {
        const item = node.source ? items.get(node.source) : undefined;
        if (!item) return null;
        const problems = await checksOf(item);
        return problems.length ? `Held back: ${problems.join("; ")}` : null;
      },
    });

    // ---------- a run doesn't quiet its own misses ----------

    ctx.get<GraphStage>("graph.stage").stage(async (change, next) => {
      const run = change.header.run;
      if (run) {
        const touched = [...new Set(change.facts.filter((f) => GUARDED.has(f[2]) && items.has(f[1])).map((f) => f[1]))];
        if (touched.length) {
          const judged = await verdicts.run(run);
          for (const id of touched) {
            const n = nodeOf(id);
            const v = n && judged.find((x) => x.node === n.id);
            if (v && v.after > 0) {
              throw new Refused({
                code: "keep.self_edit",
                message: `${n!.title} was said to this run and its miss came after (#${v.failed_by.join(", #")}). This run can't rewrite, promote or retire it to quiet its own misses; another run, or a person, can.`,
                by,
                detail: { node: n!.id, item: id, failed_by: v.failed_by },
              });
            }
          }
        }
      }
      return next(change);
    });

    // ---------- standing, review and apply ----------

    const peers = (): Peer[] =>
      [...items.values()]
        .filter((i) => i.fields.status !== "retired" && !str(i.fields.voice) && str(i.fields.words))
        .map((i) => ({ id: i.id, title: str(i.fields.title) || i.id, at: atOf(i), words: str(i.fields.words), kept: i.fields.status === undefined }));

    /**
     * A node's record without the run it was written in: there its miss came
     * before it was said only because it was written for that miss, which
     * is no evidence that it helps.
     */
    const tallyOf = async (node: string, from?: string): Promise<(Tally & { last?: string }) | undefined> => {
      const rec = await verdicts.record(node);
      if (!rec) return undefined;
      const t: Tally & { last?: string } = { said: rec.said, runs: rec.runs, held: rec.held, failed: rec.failed, quiet: rec.quiet, ...(rec.last ? { last: rec.last } : {}) };
      if (!from) return t;
      for (let p = await verdicts.verdicts(node, { limit: LIMIT_MAX }); ; p = await verdicts.verdicts(node, { limit: LIMIT_MAX, after: p.next })) {
        const v = p.items.find((x) => x.run === from);
        if (v) {
          t.runs--;
          t[v.verdict]--;
          t.said -= v.said;
          return t;
        }
        if (!p.next) return t;
      }
    };

    const reviewOne = async (item: Item, all: Peer[]): Promise<Reviewed> => {
      const n = nodeOf(item.id);
      const record = n ? await tallyOf(n.id, str(item.fields.from_run) || undefined) : undefined;
      const status = str(item.fields.status) || "kept";
      const decided = decidedOf(item);
      return {
        item: item.id,
        ...(n ? { node: n.id } : {}),
        title: str(item.fields.title) || item.id,
        at: atOf(item),
        status,
        ...(record ? { record } : {}),
        ...(status === "trial" ? { standing: standing({ id: item.id, at: atOf(item), words: str(item.fields.words) }, record, all, t) } : {}),
        checks: await checksOf(item),
        ...(decided ? { decided } : {}),
      };
    };

    const review = async (only?: Id): Promise<Review> => {
      const all = peers();
      const list = [...items.values()].filter((i) => (only ? i.id === only : i.fields.status === "trial" || !!decidedOf(i)) && !str(i.fields.voice));
      return { thresholds: t, apply: applying, nodes: await Promise.all(list.map((i) => reviewOne(i, all))) };
    };

    const register = ctx.get<ActionRegister>("action.register");
    register.register({
      name: "keep.review",
      title: "Each trial node's record and standing, and the nodes decided",
      doc: "Per trial node: its record (said, runs, held, failed, quiet), its standing (trial, promote or retire, and why), and its checks (why a gate holds it back). With the nodes promoted or retired by record or by a person. `node` narrows to one item. Writes nothing.",
      input: { type: "object", properties: { node: { type: "string", description: "A node's item id." } } },
      async run(input: { node?: Id }) {
        return (await review(input.node)) as unknown as Json;
      },
    });

    register.register({
      name: "keep.apply",
      title: "Promote or retire a node, with why",
      doc: "promote: said as kept from now on (words.promote). retire: no longer said (words.retire). Writes `decided` with the rule, why, who and the record, in the same change set, so history.undo takes both back.",
      input: {
        type: "object",
        properties: {
          node: { type: "string", description: "The node's item id." },
          state: { enum: ["promote", "retire"] },
          rule: { type: "string" },
          why: { type: "string" },
        },
        required: ["node", "state"],
      },
      async run(input: { node: Id; state: "promote" | "retire"; rule?: string; why?: string }, call: ActionContext) {
        const [item] = await graph.get([input.node]);
        if (!item || item.type !== TYPE) throw new Refused({ code: "keep.not_a_node", message: `${input.node} is not a node on the map.`, by });
        if (input.state !== "promote" && input.state !== "retire") throw new Refused({ code: "keep.state", message: "state is promote or retire.", by });
        await call.call(input.state === "promote" ? "words.promote" : "words.retire", { node: input.node });
        const n = nodeOf(input.node);
        const rec = n ? await tallyOf(n.id, str(item.fields.from_run) || undefined) : undefined;
        const decided: Decided = {
          state: input.state,
          ...(input.rule ? { rule: input.rule } : {}),
          why: input.why ?? call.reason,
          by: call.caller.actor?.id ?? `pack:${call.caller.pack}`,
          at: new Date().toISOString(),
          ...(n ? { node: n.id } : {}),
          ...(rec ? { record: { said: rec.said, runs: rec.runs, held: rec.held, failed: rec.failed, quiet: rec.quiet } } : {}),
        };
        const facts: Fact[] = [];
        if (item.fields.decided !== undefined) facts.push(["-", input.node, "decided", item.fields.decided]);
        facts.push(["+", input.node, "decided", decided as unknown as Json]);
        call.write(facts);
        return { node: input.node, state: input.state };
      },
    });

    const decide = async () => {
      if (!applying || !has("words.promote") || !has("words.retire")) return;
      const all = peers();
      for (const item of [...items.values()]) {
        if (item.fields.status !== "trial" || str(item.fields.voice)) continue;
        const r = await reviewOne(item, all);
        const s = r.standing;
        if (!s || s.state === "trial") continue;
        const runs = r.record?.runs ?? 0;
        if ((decidedAt.get(item.id) ?? -1) >= runs) continue;
        decidedAt.set(item.id, runs);
        const out = await invoke.invoke({
          action: "keep.apply",
          input: { node: item.id, state: s.state, ...(s.rule ? { rule: s.rule } : {}), why: s.why },
          authority: { of: "agent", basis: `the keep rule ${s.rule}: ${s.why}` },
          reason: `${s.state === "promote" ? "Promoted" : "Retired"} the trial node ${r.title} by its record: ${s.why}`,
        });
        if (!out.ok && out.refused.code !== "words.held") ctx.runtime.report(ctx.fiber, new Error(out.refused.message));
      }
    };
    function soon() {
      clearTimeout(timer);
      if (gone) return;
      timer = setTimeout(() => {
        busy = busy.then(() => (gone ? undefined : decide())).catch((err) => ctx.runtime.report(ctx.fiber, err));
      }, 500);
    }
    verdicts.watch(() => soon());
    soon();
  },
};

export default keep;
