/**
 * What the map says, as the agent gets it. Pure, and read by the harness
 * view's run pane too, so what it shows is what the hook printed.
 *
 * - Each node's words come under a short tag naming it: its title, cut
 *   short, never a path or an id. A node that says one line gets one line,
 *   `[Title] words`; longer words get the tag on a line of their own.
 * - At `session_start` the standing words (`instruction` nodes) come first,
 *   by node id, so the start of what the map says is the same from run to
 *   run whatever order the plugins loaded in; the rest (what changes per run)
 *   follows in the answer's order.
 * - All of it fits a budget (`CONTEXT_MAX` characters by default): Claude
 *   Code keeps about 10,000 characters of a hook's context and moves the
 *   rest to a file the agent is not made to read. Past the budget the
 *   refusal is said whole, then the words of this place's other nodes, then
 *   standing words while they fit; every node left over is listed in one line
 *   (its tag, and how to get its words in full), so nothing goes missing
 *   without the agent knowing (`fitted`).
 */
import type { Answer, Place } from "../../spec/agent.ts";

/** What the adapter knows of a node that spoke: from `agent.tree`. */
export interface Speaker {
  title?: string;
  kind?: string;
  /** The map item it was made from: its words in full through `get`. */
  source?: string;
}
export type Speakers = (node: string) => Speaker | undefined;

/** A tag's length at most, in characters. */
export const TAG_MAX = 48;

/** A map item id (`e_7k2m9q4w`, `i_mw0demo0item1`) or a node id (`words/e_…`). */
const ID = /^(?:[a-z]+\/)?[a-z]_[a-z0-9]{6,}$/i;

/** A node's tag: its title, short, with no path or id in it. Its kind when the title is nothing else. */
export function tagOf(node: string, speakers?: Speakers): string {
  const s = speakers?.(node);
  const words = String(s?.title ?? "")
    .split(/\s+/)
    .map((w) => (/[\\/]/.test(w) && !ID.test(w) ? (w.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "") : w))
    .filter((w) => w && !ID.test(w) && w !== node);
  let tag = words.join(" ").trim().replace(/[\s:;,.]+$/, "");
  if (!tag) tag = s?.kind ?? "node";
  if (tag.length > TAG_MAX) {
    const cut = tag.slice(0, TAG_MAX - 1);
    const sp = cut.lastIndexOf(" ");
    tag = `${(sp > TAG_MAX / 2 ? cut.slice(0, sp) : cut).trimEnd()}…`;
  }
  return tag.replace(/[[\]]/g, "");
}

/** One node's words under its tag; as they are when the node isn't known (it unloaded). */
export function taggedText(node: string, text: string, speakers?: Speakers): string {
  if (!speakers?.(node)) return text;
  const tag = `[${tagOf(node, speakers)}]`;
  return text.includes("\n") ? `${tag}\n${text}` : `${tag} ${text}`;
}

/** Whether a node's words are standing: the same for every run. */
const standing = (node: string, speakers?: Speakers) => speakers?.(node)?.kind === "instruction";

/** What was said, in the order the agent gets it: at `session_start`, standing words first, by node id. */
export function ordered<T extends { node: string }>(said: T[], speakers?: Speakers, places?: Place[]): T[] {
  if (!places?.includes("session_start")) return said;
  const first = said.filter((s) => standing(s.node, speakers)).sort((a, b) => (a.node < b.node ? -1 : a.node > b.node ? 1 : 0));
  return [...first, ...said.filter((s) => !standing(s.node, speakers))];
}

/**
 * A hook's context at most, in characters: under Claude Code's 10,000, with
 * room for the system-reminder it is wrapped in.
 */
export const CONTEXT_MAX = 9000;

/** What a hook says, and the nodes in it said as one line rather than whole. */
export interface Fitted {
  text: string;
  /** Node ids listed in a line each, in the order said. Empty: every node was said whole. */
  listed: string[];
}

const GAP = "\n\n";

/** How the agent hears the words of a node listed at this place: `get` on its map item, else `hear` on the place. */
const fullBy = (node: string, speakers: Speakers | undefined, places: Place[] | undefined) => {
  const source = speakers?.(node)?.source;
  return source ? `get {"ids":["${source}"]}` : `hear {"place":"${places?.[0] ?? "session_start"}"}`;
};

/** One line for a node said as a line: its tag, and how to get its words in full. */
export function listedLine(node: string, speakers?: Speakers, places?: Place[]): string {
  return `- [${tagOf(node, speakers)}] in full: ${fullBy(node, speakers, places)}`;
}

/** The line before the listed nodes: why they are listed, and how to get them. */
export function listedHead(n: number, of: number, budget: number): string {
  return `[More from the map] The words here pass this hook's ${budget} characters, so ${n} of its ${of} nodes are one line each. Get any of them in full with the tool its line names.`;
}

/**
 * What was said (and the refusal, first) as one block of at most `budget`
 * characters. Under budget: every node's words whole, in `ordered`'s order.
 * Past it the refusal stays whole; then this place's other words, then the
 * standing words, are said whole while each fits, in the answer's order; the
 * rest are listed a line each after them. Those said whole keep `ordered`'s
 * order. Lines that still don't fit end in one line that counts them.
 */
export function fitted(said: Answer["said"], speakers?: Speakers, places?: Place[], budget = CONTEXT_MAX, refused?: Answer["refused"]): Fitted | undefined {
  const all = ordered(said, speakers, places);
  const head = refused ? [taggedText(refused.node, refused.text, speakers)] : [];
  const whole = all.map((s) => taggedText(s.node, s.text, speakers));
  const full = [...head, ...whole].join(GAP);
  if (!full) return undefined;
  if (full.length <= budget) return { text: full, listed: [] };

  const lines = all.map((s) => listedLine(s.node, speakers, places));
  const keep = new Set<number>();
  const block = (list: string[] = all.flatMap((_, i) => (keep.has(i) ? [] : [lines[i]!]))) => {
    const out = all.length - keep.size;
    const said = whole.filter((_, i) => keep.has(i));
    return [...head, ...said, ...(out ? [[listedHead(out, all.length, budget), ...list].join("\n")] : [])].join(GAP);
  };
  // This place's words before the standing ones, each kind in the answer's order.
  const rank = all.map((_, i) => i).sort((a, b) => Number(standing(all[a]!.node, speakers)) - Number(standing(all[b]!.node, speakers)) || a - b);
  for (const i of rank) {
    keep.add(i);
    if (block().length > budget) keep.delete(i);
  }
  const listed = all.flatMap((s, i) => (keep.has(i) ? [] : [s.node]));
  const list = all.flatMap((_, i) => (keep.has(i) ? [] : [lines[i]!]));
  let text = block(list);
  for (let cut = 1; text.length > budget && cut < list.length; cut++) {
    text = block([...list.slice(0, list.length - cut), `- and ${cut} more: hear {"place":"${places?.[0] ?? "session_start"}"}`]);
  }
  return { text, listed };
}

/** Everything said, as one block for the model, each node's words under its tag, in the budget. */
export function told(said: Answer["said"], speakers?: Speakers, places?: Place[], budget = CONTEXT_MAX): string | undefined {
  return fitted(said, speakers, places, budget)?.text;
}

/** A refusal's words under its tag, with what else was said after them, in the budget: the refusal first and whole. */
export function refusalTold(answer: Answer, speakers?: Speakers, places?: Place[], budget = CONTEXT_MAX): string {
  return fitted(answer.said, speakers, places, budget, answer.refused)!.text;
}
