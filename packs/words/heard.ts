/**
 * What each run heard from the words pack's nodes, so a change to a node
 * the run already heard is told as the change: its new words, or one line
 * saying it no longer applies. And the one line a listed node says at
 * `session_start` in place of its whole words.
 *
 * Held per run since its last `compact` (what was heard before a
 * compaction is gone from the agent's context), at most `RUNS` runs.
 */
import type { Place, RunId } from "../../spec/agent.ts";
import type { Id } from "../../spec/common.ts";
import type { Item } from "../../spec/graph.ts";

/** A pack-own key: what the words tool tells the words pack it handed a run. */
export const HEARD = "words.heard";

/** How a node says its words at `session_start`: `whole` (the default) or `listed`, one line. */
export type SayHow = "whole" | "listed";
export const SAY_HOW: SayHow[] = ["whole", "listed"];

export const sayHow = (item: Item | null | undefined): SayHow => (item?.fields.say === "listed" ? "listed" : "whole");

/** The words tool's name on the adapter's MCP server. */
export const TOOL = "words";

/** What a run's context holds from one node. */
export interface Heard {
  /** The words as said (a listed node's: its line). */
  text: string;
  title: string;
  /** Only its line was said. */
  listed: boolean;
  /** Told by the change node, not by the node at its place. */
  told?: boolean;
}

export interface WordsHeard {
  /** The run was handed the node's whole words (the words tool). */
  heard(run: RunId, node: Id): Promise<void>;
}

/** At most this many runs held; the oldest goes first. */
export const RUNS = 200;

export class Hearing {
  private runs = new Map<RunId, Map<Id, Heard>>();

  of(run: RunId): Map<Id, Heard> {
    let m = this.runs.get(run);
    if (!m) {
      m = new Map();
      this.runs.set(run, m);
      if (this.runs.size > RUNS) this.runs.delete(this.runs.keys().next().value!);
    }
    return m;
  }

  get(run: RunId, node: Id): Heard | undefined {
    return this.runs.get(run)?.get(node);
  }

  note(run: RunId, node: Id, h: Heard) {
    this.of(run).set(node, h);
  }

  /** A compaction: nothing heard is in the context now. */
  forget(run: RunId) {
    this.runs.delete(run);
  }
}

/** A node's whole words as said: a trial's after its mark. */
export function wholeWords(item: Item, trialMark: string): string {
  const text = typeof item.fields.words === "string" ? item.fields.words.trim() : "";
  if (!text) return "";
  return item.fields.status === "trial" ? `${trialMark} ${text}` : text;
}

/** A listed node's line at `session_start`: its title, where its words are said, and how to ask for them. */
export function listing(item: Item): string {
  const title = String(item.fields.title ?? item.id);
  const at = (Array.isArray(item.fields.at) ? (item.fields.at as Place[]) : []).filter((p) => p !== "session_start");
  const where = at.length ? `said in full at ${at.join(", ")}; ` : "";
  return `${title}: ${where}its words from the ${TOOL} tool, node ${item.id}.`;
}

/** What changed in the nodes a run heard, one line each, as the run should hear it now. Updates what it heard. */
export function changes(heard: Map<Id, Heard>, now: Map<Id, Item | null>, trialMark: string): string[] {
  const lines: string[] = [];
  for (const [id, h] of [...heard]) {
    // Heard after `now` was read (another node said at this same moment): nothing has changed since; told next time if so.
    if (!now.has(id)) continue;
    const item = now.get(id) ?? null;
    if (!item || item.fields.status === "retired") {
      lines.push(`"${h.title}" no longer applies: it was retired on the map.`);
      heard.delete(id);
      continue;
    }
    const title = String(item.fields.title ?? id);
    const text = h.listed ? listing(item) : wholeWords(item, trialMark);
    if (text === h.text) continue;
    if (!text) {
      lines.push(`"${h.title}" no longer applies: its words were emptied.`);
      heard.delete(id);
      continue;
    }
    lines.push(h.listed ? `"${h.title}" is now listed as: ${text}` : `"${h.title}"${title !== h.title ? ` (now "${title}")` : ""} now says: ${text}`);
    heard.set(id, { text, title, listed: h.listed, told: true });
  }
  return lines;
}
