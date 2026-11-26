/**
 * The since plugin: "Since you last heard". One node at `prompt` and before
 * each tool call (`tool:*`) that tells the agent, briefly, what a person did
 * on the map since the run last heard from it: the change sets a person
 * committed, not made in the run itself, and the calls to a model a person
 * asked that failed (a call run whose `asked_kind` is person and whose reply
 * failed), unless they belong under another agent's run. So a working agent
 * hears what the person does on the page at its next step, and an idle one
 * at its next prompt. Quiet when there is nothing. Injects graph.read and
 * graph.watch to follow the change sets, exchange.read and exchange.watch
 * for the calls, and agent.node for its node.
 *
 * The person's change sets are kept in memory, newest last, at most `keep`
 * (they are read back from `graph.since` when the plugin loads). When the plugin
 * hasn't seen the run hear yet (a restart), it counts from the run's start.
 */
import type { ActionInvoke, ActionList } from "../../spec/action.ts";
import type { AgentNode, RunId, RunInfo } from "../../spec/agent.ts";
import type { Committed } from "../../spec/changeset.ts";
import type { Id, Json, Time } from "../../spec/common.ts";
import type { ExchangeEvent, ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import type { GraphRead, GraphWatch } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Plugin } from "../../runtime/core.ts";

export interface SinceConfig {
  /** How many of a person's change sets are kept to tell. Default 200. */
  keep?: number;
  /** At most this many lines are said; the rest are counted. Default 8. */
  lines?: number;
}

/** What an action did, in a word, for the line that says it. */
const VERBS: Record<string, string> = {
  "items.create": "made",
  "items.set": "changed",
  "items.link": "linked",
  "items.unlink": "unlinked",
  "words.set": "reworded",
  "words.retire": "retired",
  "words.add": "added a node",
  "history.undo": "undid a change to",
  "mcp.tell": "said",
};
const verbOf = (action: string) => VERBS[action] ?? action;

/** Short text: one line, at most n characters. */
const short = (s: string, n = 80) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

/**
 * The wording the first time: a node item on the map (its `voice` is
 * since/heard), so `words.set` rewords it. The code fills in {changes}, a
 * line per change set.
 */
export const HEARD_WORDS = "Since you last heard, a person changed the map:\n{changes}";

/** The heading a person's failed calls are told under, apart from their changes. */
export const FAILED_WORDS = "Since you last heard, a call to a model a person asked failed:";

/** Where it speaks: at each prompt, and before each tool call, so a working agent hears at its next step. */
export const PLACES = ["prompt", "tool:*"];

/** A call to a model a person asked, that failed. */
export interface Failed {
  /** Its place in the order failures came in: what a run was told up to is kept by it, not by time. */
  n: number;
  run: RunId;
  time: Time;
  title: string;
  /** The run it was made under, when one was named. */
  parent?: RunId;
  model?: string;
  text: string;
}

/** Whether a run should hear of a failed call: one made under it, or under no agent's run (a plugin's own run of calls). */
export const forRun = (f: Failed, run: RunId) => !f.parent || f.parent === run || f.parent.startsWith("calls:");

/** A failed call's line. */
export const failedLine = (f: Failed) =>
  `- "${short(f.title, 60)}"${f.model ? ` (${f.model})` : ""}: ${short(f.text, 160)}. Its replies: act typed.get { "run": "${f.run}" }`;

const fill = (template: string, vars: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k]! : m));

/** The lines that tell what the people's change sets did, given the titles of what they touched, in the wording given. */
export function tell(sets: Committed[], titles: Map<Id, string>, max: number, words = HEARD_WORDS, failed: Failed[] = []): string {
  const lines = sets.slice(-max).map((c) => {
    const named = [...new Set(c.facts.map((f) => f[1]))].map((id) => titles.get(id)).filter((t): t is string => !!t);
    const what = named.length ? named.slice(0, 3).map((t) => `"${short(t, 60)}"`).join(", ") + (named.length > 3 ? ` and ${named.length - 3} more` : "") : "the map";
    const why = c.header.reason ? `: ${short(c.header.reason)}` : "";
    return `- ${verbOf(c.header.action)} ${what}${why}`;
  });
  const more = sets.length > max ? `\n(and ${sets.length - max} earlier)` : "";
  const changed = lines.length ? fill(words, { changes: `${lines.join("\n")}${more}` }) : "";
  // A failed call is not a change: told under its own heading.
  const calls = failed.length ? `${FAILED_WORDS}\n${failed.slice(-max).map(failedLine).join("\n")}` : "";
  return [changed, calls].filter(Boolean).join("\n");
}

const since: Plugin<SinceConfig> = {
  id: "since",
  about: "Tells an agent what changed on the map since it last heard.",
  inject: ["graph.read", "graph.watch", "agent.node", "action.list", "action.invoke", "exchange.read", "exchange.watch"],
  async apply(ctx: Context, config: SinceConfig = {}) {
    const graph = ctx.get<GraphRead>("graph.read");
    const TITLE = "Since you last heard";
    // Its wording is on the map, when a plugin declares words.voice; else the default here.
    let source: Id | undefined;
    if (ctx.get<ActionList>("action.list").list().some((a) => a.name === "words.voice")) {
      const out = await ctx.get<ActionInvoke>("action.invoke").invoke<{ node: Id }>({
        action: "words.voice",
        input: { voice: "since/heard", title: TITLE, kind: "reflex", at: PLACES, words: HEARD_WORDS },
        authority: { of: "agent", basis: "the since plugin's wording, on the map" },
        reason: "Put the since-you-last-heard wording on the map",
      });
      if (out.ok) source = out.output.node;
    }
    const keep = config.keep ?? 200;
    const max = config.lines ?? 8;
    const sets: Committed[] = [];
    const add = (c: Committed) => {
      if (c.header.actor.kind !== "person") return;
      sets.push(c);
      if (sets.length > keep) sets.splice(0, sets.length - keep);
    };
    const cursor = await graph.now();
    const upTo = Number(cursor);
    for (let p = await graph.since({ limit: LIMIT_MAX }); ; p = await graph.since({ limit: LIMIT_MAX, after: p.next })) {
      for (const c of p.items) if (!(c.seq > upTo)) add(c);
      if (!p.next) break;
    }
    ctx.get<GraphWatch>("graph.watch").watch({ after: cursor }, add);

    // A person's failed calls: a call's failed reply, its run read once for who asked.
    const exchange = ctx.get<ExchangeRead>("exchange.read");
    const failed: Failed[] = [];
    let arrived = 0;
    /** Per run, the last failure it was told of (or passed over, when it first heard). */
    const toldUpTo = new Map<RunId, number>();
    const runOf = async (id: RunId): Promise<RunInfo | undefined> => {
      let p = await exchange.runs({ limit: 50 });
      for (let pages = 0; pages < 4; pages++) {
        const r = p.items.find((x) => x.run === id);
        if (r || !p.next) return r;
        p = await exchange.runs({ limit: 50, after: p.next });
      }
      return undefined;
    };
    ctx.get<ExchangeWatch>("exchange.watch").watch({ kinds: ["act"] }, (e: ExchangeEvent) => {
      if (e.place !== "reply_end" || e.act?.kind !== "reply" || e.act.ok !== false) return;
      void runOf(e.run).then((r) => {
        const f = r?.facts ?? {};
        if (f.harness !== "call" || f.asked_kind !== "person") return;
        const out = e.act?.output as { text?: Json } | undefined;
        failed.push({
          n: ++arrived,
          run: e.run,
          time: e.time,
          title: r?.title ?? e.run,
          ...(typeof f.parent === "string" ? { parent: f.parent } : {}),
          ...(typeof f.model === "string" ? { model: f.model } : {}),
          text: typeof out?.text === "string" ? out.text : e.text ?? "it failed",
        });
        if (failed.length > keep) failed.splice(0, failed.length - keep);
      });
    });

    /** When each run last heard: its last prompt. */
    const heard = new Map<RunId, Time>();
    ctx.get<AgentNode>("agent.node").node({
      name: "heard",
      kind: "reflex",
      title: TITLE,
      at: PLACES,
      ...(source ? { source } : {}),
      async speak(moment, run) {
        const from = heard.get(run.run) ?? run.started;
        heard.set(run.run, moment.time);
        const news = sets.filter((c) => (c.committed ?? c.header.time) > from && c.header.run !== run.run);
        const upTo = toldUpTo.get(run.run);
        const calls = failed.filter((f) => (upTo === undefined ? f.time >= run.started : f.n > upTo) && forRun(f, run.run));
        toldUpTo.set(run.run, arrived);
        if (!news.length && !calls.length) return null;
        const ids = [...new Set(news.slice(-max).flatMap((c) => c.facts.map((f) => f[1])))].slice(0, LIMIT_MAX);
        const items = await graph.get(ids);
        const titles = new Map<Id, string>();
        items.forEach((it) => {
          const t = it?.fields.title as Json | undefined;
          if (it && typeof t === "string") titles.set(it.id, t);
        });
        const [voice] = source ? await graph.get([source]) : [null];
        const words = voice && voice.fields.status !== "retired" && typeof voice.fields.words === "string" && voice.fields.words.trim() ? voice.fields.words : HEARD_WORDS;
        return { say: tell(news, titles, max, words, calls) };
      },
    });
  },
};

export default since;
