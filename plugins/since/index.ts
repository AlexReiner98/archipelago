/**
 * The since plugin: "Since you last heard". One node at `prompt` that tells
 * the agent, briefly, what a person changed on the map since the run last
 * heard from it: the change sets a person committed after the run's last
 * prompt (or its start), not made in the run itself. Quiet when there are
 * none. Injects graph.read and graph.watch to follow the change sets, and
 * agent.node for its node.
 *
 * The person's change sets are kept in memory, newest last, at most `keep`
 * (they are read back from `graph.since` when the plugin loads). When the plugin
 * hasn't seen the run hear yet (a restart), it counts from the run's start.
 */
import type { ActionInvoke, ActionList } from "../../spec/action.ts";
import type { AgentNode, RunId } from "../../spec/agent.ts";
import type { Committed } from "../../spec/changeset.ts";
import type { Id, Json, Time } from "../../spec/common.ts";
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

const fill = (template: string, vars: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k]! : m));

/** The lines that tell what the people's change sets did, given the titles of what they touched, in the wording given. */
export function tell(sets: Committed[], titles: Map<Id, string>, max: number, words = HEARD_WORDS): string {
  const lines = sets.slice(-max).map((c) => {
    const named = [...new Set(c.facts.map((f) => f[1]))].map((id) => titles.get(id)).filter((t): t is string => !!t);
    const what = named.length ? named.slice(0, 3).map((t) => `"${short(t, 60)}"`).join(", ") + (named.length > 3 ? ` and ${named.length - 3} more` : "") : "the map";
    const why = c.header.reason ? `: ${short(c.header.reason)}` : "";
    return `- ${verbOf(c.header.action)} ${what}${why}`;
  });
  const more = sets.length > max ? `\n(and ${sets.length - max} earlier)` : "";
  return fill(words, { changes: `${lines.join("\n")}${more}` });
}

const since: Plugin<SinceConfig> = {
  id: "since",
  about: "Tells an agent what changed on the map since it last heard.",
  inject: ["graph.read", "graph.watch", "agent.node", "action.list", "action.invoke"],
  async apply(ctx: Context, config: SinceConfig = {}) {
    const graph = ctx.get<GraphRead>("graph.read");
    const TITLE = "Since you last heard";
    // Its wording is on the map, when a plugin declares words.voice; else the default here.
    let source: Id | undefined;
    if (ctx.get<ActionList>("action.list").list().some((a) => a.name === "words.voice")) {
      const out = await ctx.get<ActionInvoke>("action.invoke").invoke<{ node: Id }>({
        action: "words.voice",
        input: { voice: "since/heard", title: TITLE, kind: "reflex", at: ["prompt"], words: HEARD_WORDS },
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

    /** When each run last heard: its last prompt. */
    const heard = new Map<RunId, Time>();
    ctx.get<AgentNode>("agent.node").node({
      name: "heard",
      kind: "reflex",
      title: TITLE,
      at: ["prompt"],
      ...(source ? { source } : {}),
      async speak(moment, run) {
        const from = heard.get(run.run) ?? run.started;
        heard.set(run.run, moment.time);
        const news = sets.filter((c) => (c.committed ?? c.header.time) > from && c.header.run !== run.run);
        if (!news.length) return null;
        const ids = [...new Set(news.slice(-max).flatMap((c) => c.facts.map((f) => f[1])))].slice(0, LIMIT_MAX);
        const items = await graph.get(ids);
        const titles = new Map<Id, string>();
        items.forEach((it) => {
          const t = it?.fields.title as Json | undefined;
          if (it && typeof t === "string") titles.set(it.id, t);
        });
        const [voice] = source ? await graph.get([source]) : [null];
        const words = voice && voice.fields.status !== "retired" && typeof voice.fields.words === "string" && voice.fields.words.trim() ? voice.fields.words : HEARD_WORDS;
        return { say: tell(news, titles, max, words) };
      },
    });
  },
};

export default since;
