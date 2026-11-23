/**
 * What the map says, as the agent gets it. Pure, and read by the harness
 * view's run pane too, so what it shows is what the hook printed.
 *
 * - Each node's words come under a short tag naming it: its title, cut
 *   short, never a path or an id. A node that says one line gets one line,
 *   `[Title] words`; longer words get the tag on a line of their own.
 * - At `session_start` the standing words (`instruction` nodes) come first,
 *   by node id, so the start of what the map says is the same from run to
 *   run whatever order the packs loaded in; the rest (what changes per run)
 *   follows in the answer's order.
 */
import type { Answer, Place } from "../../spec/agent.ts";

/** What the adapter knows of a node that spoke: from `agent.tree`. */
export interface Speaker {
  title?: string;
  kind?: string;
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

/** Everything said, as one block for the model, each node's words under its tag. */
export function told(said: Answer["said"], speakers?: Speakers, places?: Place[]): string | undefined {
  if (!said.length) return undefined;
  return ordered(said, speakers, places).map((s) => taggedText(s.node, s.text, speakers)).join("\n\n");
}

/** A refusal's words under its tag, with what else was said after them. */
export function refusalTold(answer: Answer, speakers?: Speakers, places?: Place[]): string {
  const r = answer.refused!;
  const rest = told(answer.said, speakers, places);
  const head = taggedText(r.node, r.text, speakers);
  return rest ? `${head}\n\n${rest}` : head;
}
