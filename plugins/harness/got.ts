/**
 * What the agent got at a say's moment: the block the Claude Code adapter
 * printed, rebuilt from the moment's events with the adapter's own
 * formatting (plugins/claude-code/context.ts), so the run pane shows the text
 * exactly as the hook handed it. Pure.
 *
 * A moment is the run of to-agent says and refusals next to each other at
 * one time. Words said at `skill:` and `memory:` places aren't handed back
 * (the harness already loaded them): nothing.
 */
import type { Answer } from "../../spec/agent.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";
import { refusalTold, told, type Speaker } from "../claude-code/context.ts";

const spoke = (e: ExchangeEvent | undefined, at: ExchangeEvent) =>
  !!e && e.direction === "to_agent" && (e.kind === "say" || e.kind === "refuse") && e.time === at.time && !!e.node && !/^(skill|memory):/.test(e.place ?? "");

/** The block the agent got with event `i`, or nothing when it isn't a say or refusal that was handed over. */
export function gotAt(events: ExchangeEvent[], i: number, speakers: Map<string, Speaker>): string | undefined {
  const at = events[i];
  if (!at || !spoke(at, at)) return undefined;
  let a = i;
  let b = i;
  while (spoke(events[a - 1], at)) a--;
  while (spoke(events[b + 1], at)) b++;
  const moment = events.slice(a, b + 1);
  const said: Answer["said"] = moment.filter((e) => e.kind === "say").map((e) => ({ node: e.node!, text: e.text ?? "" }));
  const refused = moment.find((e) => e.kind === "refuse");
  const places = [...new Set(moment.map((e) => e.place).filter((p): p is string => !!p))];
  const who = (id: string) => speakers.get(id);
  if (refused) return refusalTold({ said, refused: { node: refused.node!, text: refused.text ?? "" } }, who, places);
  return told(said, who, places);
}
