/**
 * The scripted plugin: an agent with no model. It plays a hand-written script,
 * or a run recorded on the exchange, through `agent.run`, as the Claude Code
 * adapter would, so a test or a plugin drives a whole run and reads what was
 * said, refused and judged. Injects `agent.run` and `exchange.read`;
 * provides its own `scripted.play`. Playing is in script.ts, apart from the
 * runtime.
 */
import type { RunId } from "../../spec/agent.ts";
import type { Actor } from "../../spec/common.ts";
import { META } from "../../spec/common.ts";
import type { ExchangeEvent, ExchangeRead } from "../../spec/exchange.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import type { AgentRun } from "../../spec/agent.ts";
import { play, scriptOf, type Played, type Script } from "./script.ts";

export { HARNESS, play, relativePath, scriptOf, toolPlaces, type Played, type Script, type Step } from "./script.ts";

/** The agent a scripted run is, unless it is given another. */
export const SCRIPTED: Actor = { id: "e_scripted", kind: "agent" };

let made = 0;
const newRun = () => `scripted-${Date.now().toString(36)}-${(made++).toString(36)}`;

/** How a script is played. */
export interface PlayOptions {
  /** The run's id; else a new one. */
  run?: RunId;
  actor?: Actor;
}

/**
 * Plays a script from any context that injects `agent.run`: the run gets a
 * child context intercepted with its actor and id, as an adapter's does.
 */
export function playAs(ctx: Context, script: Script, options: PlayOptions = {}): Promise<Played> {
  const run = options.run ?? newRun();
  const actor = options.actor ?? SCRIPTED;
  const agent = ctx.intercept({ [META.actor]: actor, [META.run]: run }).get<AgentRun>("agent.run");
  return play(agent, run, actor, script);
}

/** Every event of a recorded run, a page at a time. */
export async function eventsOf(read: ExchangeRead, run: RunId): Promise<ExchangeEvent[]> {
  const out: ExchangeEvent[] = [];
  let after: string | undefined;
  do {
    const page = await read.events(run, { limit: LIMIT_MAX, ...(after ? { after } : {}) });
    out.push(...page.items);
    after = page.next;
  } while (after);
  return out;
}

/** `scripted.play`: this plugin's own key. */
export interface ScriptedPlay {
  /** Plays a script as a run of its own. */
  play(script: Script, options?: PlayOptions): Promise<Played>;
  /**
   * Plays a recorded run again, under a new run id, against the nodes
   * loaded now: its acts as they were, the map asked again at its places.
   * The replay's run has the fact `replay_of`, the recorded run.
   */
  replay(run: RunId, options?: PlayOptions): Promise<Played>;
}

const scripted: Plugin = {
  id: "scripted",
  about: "Plays a run with no model: a script, or a recorded run again.",
  inject: ["agent.run", "exchange.read"],
  apply(ctx: Context) {
    const read = ctx.get<ExchangeRead>("exchange.read");
    ctx.provide<ScriptedPlay>("scripted.play", () => ({
      play: (script, options) => playAs(ctx, script, options),
      async replay(run, options) {
        const events = await eventsOf(read, run);
        if (!events.length) throw new Error(`No run ${run} on the exchange.`);
        const script = scriptOf(events);
        // Not started by the recorded run's parent: the replay is its own.
        const { parent: _parent, ...start } = script.start ?? {};
        script.start = { ...start, harness: "scripted", title: `Replay of ${start.title ?? run.slice(0, 8)}`, facts: { ...start.facts, replay_of: run } };
        return playAs(ctx, script, options);
      },
    }));
  },
};

export default scripted;
