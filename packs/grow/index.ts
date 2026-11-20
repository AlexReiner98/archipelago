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
 * Promoting or retiring a trial by its record is the next step, not here.
 * Injects exchange.read, agent.tree, agent.node and action.register.
 */
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import type { AgentNode, AgentTree, RunId } from "../../spec/agent.ts";
import { PLACES } from "../../spec/agent.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { ExchangeEvent, ExchangeRead } from "../../spec/exchange.ts";
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

/** The question, with the seqs it asks about on its first line. */
export function askText(misses: Miss[]): string {
  const seqs = misses.map((m) => `#${m.seq}`).join(", ");
  const one = misses.length === 1;
  const lines = [
    `Before you finish: ${one ? "a miss" : `${misses.length} misses`} in this run that nothing on the map covers (${seqs}). Write a trial node for ${one ? "it" : "each"}, so the next run hears it where it happened.`,
    ...misses.slice(0, LISTED).map((m) => `- #${m.seq} at ${m.places.join(", ")}: ${m.words}${m.doing ? ` (doing: ${m.doing})` : ""}`),
    ...(misses.length > LISTED ? [`- and ${misses.length - LISTED} more; write for the ones worth it.`] : []),
    `Write it with the archipelago MCP tool \`act\`: action "${TRIAL}", input { "seq": the miss's number, "place": one of its places exactly as listed, the narrowest that would have prevented it (its file: place when it has one; a tool: place is said before every call of that tool),"misses": the words of the miss it should prevent, "words": what to say there next time, leading with what fixed it }. If the miss teaches nothing (a typo, a one-off), say so in one line instead. If you have no such tool, say so in one line and finish.`,
  ];
  return lines.join("\n");
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

const refuse = (code: string, message: string) => new Refused({ code, message, by: { pack: "grow" } });

const grow: Pack = {
  id: "grow",
  inject: ["exchange.read", "agent.tree", "agent.node", "action.register"],
  apply(ctx: Context) {
    const read = ctx.get<ExchangeRead>("exchange.read");
    const tree = ctx.get<AgentTree>("agent.tree");

    ctx.get<AgentNode>("agent.node").node({
      name: "ask",
      kind: "reflex",
      title: "A miss nothing covers asks for a trial node",
      at: ["reply_end"],
      async speak(moment, run) {
        const events = await eventsOf(read, moment.run);
        const asked = askedIn(events, ASKER);
        const nodes = tree.nodes();
        const open = missesOf(events, run.cwd ?? cwdOf(events)).filter((m) => !asked.has(m.seq) && !covered(m, nodes, ASKER));
        return open.length ? { refuse: askText(open), code: ASK } : null;
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
        const title = (input.title ?? words.split(/(?<=[.!?:])\s/)[0] ?? words).trim().slice(0, 80);
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
