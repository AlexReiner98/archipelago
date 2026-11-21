/**
 * The grow pack: a miss nothing covers proposes a trial node.
 *
 * - Detect: at a reply's end, the run's misses (miss.ts) that no node loaded
 *   now listens at, and that weren't asked about yet in the run.
 * - Ask: its node `grow/ask` refuses at `reply_end` with the code `ask`, so
 *   the agent keeps going and hears the question (a say there reaches no
 *   one in Claude Code). The verdict pack doesn't count an asking refusal
 *   as a miss. Each miss is asked about once: the ask names its seqs on its
 *   first line, and the next ask reads them back from the exchange.
 * - Write: the action `grow.trial` makes the node through `words.add`, with
 *   `status: trial`, at one exact place (one of the miss's), the words of
 *   the miss it should prevent, and the run and seq it came from. The words
 *   pack says a trial node marked as one.
 *
 * Promoting or retiring a trial by its record is the keep pack's.
 * Coverage is the verdict pack's: a node covers a miss when it listens
 * there as narrowly as the miss allows, or its `misses` (read from the map
 * item it came from) name the miss's words (miss.ts).
 *
 * Injects exchange.read, agent.tree, agent.node, action.register and graph.read.
 */
import type { ActionContext, ActionInvoke, ActionList, ActionRegister } from "../../spec/action.ts";
import type { AgentNode, AgentTree, NodeInfo, RunId } from "../../spec/agent.ts";
import { PLACES } from "../../spec/agent.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { ExchangeEvent, ExchangeRead } from "../../spec/exchange.ts";
import type { GraphRead } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { ASK, askedIn, covered, exactPlace, missesOf, type Miss } from "./miss.ts";

export const ASKER = "grow/ask";
export const TRIAL = "grow.trial";
/** How many misses one ask lists; all of them count as asked. */
const LISTED = 5;

const FAMILIES = PLACES.map((p) => p.term.replace(/<.*>$/, ""));
const knownPlace = (place: string) => FAMILIES.some((f) => (f.endsWith(":") ? place.startsWith(f) && place.length > f.length : place === f));

export interface TrialInput {
  /** The one exact place it is said at. */
  place: string;
  /** The words of the miss it should prevent. */
  misses: string;
  /** What it says, leading with what fixed it. */
  words: string;
  title?: string;
  /** The miss it came from: its seq, in `run` (default: the caller's run). */
  seq?: number;
  run?: RunId;
}

/**
 * The question's wording, the first time: a node item on the map (its
 * `voice` is grow/ask), so `words.set` rewords it. The code fills in
 * {count} ("a miss", "3 misses"), {seqs} ("#4, #9": every ask must name
 * them, as the next ask reads them back), {each} ("it", "each") and {list}
 * (a line per miss).
 */
export const ASK_WORDS = [
  "Before you finish: {count} in this run that nothing on the map covers ({seqs}). Write a trial node for {each}, so the next run hears it where it happened.",
  "{list}",
  `Write it with the archipelago MCP tool \`act\`: action "${TRIAL}", input { "seq": the miss's number, "place": one of its places exactly as listed, the narrowest that would have prevented it (its file: place when it has one; a tool: place is said before every call of that tool), "misses": the words of the miss it should prevent (at a tool: place, they decide which misses it covers, so use the miss's own words), "words": what to say there next time, leading with what fixed it }. If the miss teaches nothing (a typo, a one-off), say so in one line instead. If you have no such tool, say so in one line and finish.`,
].join("\n");

const fill = (template: string, vars: Record<string, string>) => template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k]! : m));

/** The question about these misses, in the wording given (default ASK_WORDS). */
export function askText(misses: Miss[], words = ASK_WORDS): string {
  const one = misses.length === 1;
  const list = [
    ...misses.slice(0, LISTED).map((m) => `- #${m.seq} at ${m.places.join(", ")}: ${m.words}${m.doing ? ` (doing: ${m.doing})` : ""}`),
    ...(misses.length > LISTED ? [`- and ${misses.length - LISTED} more; write for the ones worth it.`] : []),
  ].join("\n");
  const seqs = misses.map((m) => `#${m.seq}`).join(", ");
  const text = fill(words, { count: one ? "a miss" : `${misses.length} misses`, seqs, each: one ? "it" : "each", list });
  // The next ask reads the seqs back from its first line: a wording that doesn't put them there still does.
  return words.split("\n")[0]!.includes("{seqs}") ? text : `(${seqs}) ${text}`;
}

async function eventsOf(read: ExchangeRead, run: RunId): Promise<ExchangeEvent[]> {
  const out: ExchangeEvent[] = [];
  for (let p = await read.events(run, { limit: LIMIT_MAX }); ; p = await read.events(run, { limit: LIMIT_MAX, after: p.next })) {
    out.push(...p.items);
    if (!p.next) return out;
  }
}

const cwdOf = (events: ExchangeEvent[]): string | undefined => {
  const d = events.find((e) => e.kind === "begin")?.detail;
  return d && typeof d === "object" && !Array.isArray(d) && typeof d.cwd === "string" ? d.cwd : undefined;
};

/**
 * Each node with the words of the miss it should prevent: the `misses`
 * field of the map item it was made from (its `source`), when it has one.
 */
async function withMisses(graph: GraphRead, nodes: NodeInfo[]): Promise<(NodeInfo & { misses?: string; when?: string })[]> {
  const sources = [...new Set(nodes.flatMap((n) => (n.source ? [n.source] : [])))];
  const found = new Map<string, { misses?: string; when?: string }>();
  for (let i = 0; i < sources.length; i += LIMIT_MAX) {
    for (const item of await graph.get(sources.slice(i, i + LIMIT_MAX))) {
      if (!item) continue;
      const f: { misses?: string; when?: string } = {};
      if (typeof item.fields.misses === "string" && item.fields.misses.trim()) f.misses = item.fields.misses;
      if (typeof item.fields.when === "string" && item.fields.when) f.when = item.fields.when;
      if (f.misses || f.when) found.set(item.id, f);
    }
  }
  return nodes.map((n) => (n.source && found.has(n.source) ? { ...n, ...found.get(n.source)! } : n));
}

const refuse = (code: string, message: string) => new Refused({ code, message, by: { pack: "grow" } });

const grow: Pack = {
  id: "grow",
  about: "When an agent stumbles where the map said nothing, drafts a trial node for next time.",
  inject: ["exchange.read", "agent.tree", "agent.node", "action.register", "action.list", "action.invoke", "graph.read"],
  async apply(ctx: Context) {
    const read = ctx.get<ExchangeRead>("exchange.read");
    const tree = ctx.get<AgentTree>("agent.tree");
    const graph = ctx.get<GraphRead>("graph.read");
    const TITLE = "A miss nothing covers asks for a trial node";

    // Its wording is on the map, when a pack declares words.voice; else the default here.
    let source: Id | undefined;
    if (ctx.get<ActionList>("action.list").list().some((a) => a.name === "words.voice")) {
      const out = await ctx.get<ActionInvoke>("action.invoke").invoke<{ node: Id }>({
        action: "words.voice",
        input: { voice: ASKER, title: TITLE, kind: "reflex", at: ["reply_end"], words: ASK_WORDS },
        authority: { of: "agent", basis: "the grow pack's question, worded on the map" },
        reason: "Put the grow question's wording on the map",
      });
      if (out.ok) source = out.output.node;
    }

    ctx.get<AgentNode>("agent.node").node({
      name: "ask",
      kind: "reflex",
      title: TITLE,
      at: ["reply_end"],
      ...(source ? { source } : {}),
      async speak(moment, run) {
        const events = await eventsOf(read, moment.run);
        const asked = askedIn(events, ASKER);
        const nodes = await withMisses(graph, tree.nodes());
        const open = missesOf(events, run.cwd ?? cwdOf(events)).filter((m) => !asked.has(m.seq) && !covered(m, nodes, ASKER));
        if (!open.length) return null;
        const [item] = source ? await graph.get([source]) : [null];
        const words = item && item.fields.status !== "retired" && typeof item.fields.words === "string" && item.fields.words.trim() ? item.fields.words : ASK_WORDS;
        return { refuse: askText(open, words), code: ASK };
      },
    });

    ctx.get<ActionRegister>("action.register").register({
      name: TRIAL,
      title: "Write a trial node for a miss nothing covered",
      doc: "Said only at its one exact place, marked as a trial, until its record keeps or retires it.",
      input: {
        type: "object",
        properties: {
          place: { type: "string", description: "The one exact place, such as tool:Edit or file:packs/grow/index.ts: no *." },
          misses: { type: "string", description: "The words of the miss it should prevent." },
          words: { type: "string", description: "What it says there, leading with what fixed it." },
          title: { type: "string" },
          seq: { type: "integer", description: "The miss's number in the run." },
          run: { type: "string", description: "The run the miss was in; default the caller's." },
        },
        required: ["place", "misses", "words"],
      },
      async run(input: TrialInput, call: ActionContext) {
        const place = String(input.place ?? "").trim();
        const words = String(input.words ?? "").trim();
        const misses = String(input.misses ?? "").trim();
        if (!exactPlace(place) || !knownPlace(place)) {
          throw refuse("grow.place", `A trial node is said at one exact place of the agent spec (tool:Edit, file:packs/x.ts), not ${JSON.stringify(input.place)}.`);
        }
        if (!words) throw refuse("grow.words", "A trial node needs its words: what to say there, leading with what fixed it.");
        if (!misses) throw refuse("grow.misses", "Say the words of the miss it should prevent.");
        const run = input.run ?? call.caller.run;
        const facts: Fact[] = [];
        if (input.seq !== undefined && run) {
          const events = await eventsOf(read, run);
          const miss = missesOf(events, cwdOf(events)).find((m) => m.seq === input.seq);
          if (!miss) throw refuse("grow.no_miss", `Nothing went wrong at #${input.seq} in run ${run}.`);
          if (!miss.places.includes(place)) {
            throw refuse("grow.place", `Miss #${input.seq} happened at ${miss.places.join(", ")}: say the node at one of those.`);
          }
        }
        // A title names the advice, not the "What fixed it:" it leads with.
        const lead = words.replace(/^what fixed it:\s*/i, "");
        const title = (input.title ?? lead.split(/(?<=[.!?:])\s/)[0] ?? lead).trim().slice(0, 80);
        const added = await call.call<{ node: string }>("words.add", { title, kind: "reflex", at: [place], words });
        const id = added.node;
        facts.push(["+", id, "status", "trial"], ["+", id, "misses", misses]);
        if (run) facts.push(["+", id, "from_run", run]);
        if (input.seq !== undefined) facts.push(["+", id, "from_seq", input.seq as Json]);
        call.write(facts);
        return { node: id };
      },
    });
  },
};

export default grow;
