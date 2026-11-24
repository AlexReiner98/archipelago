/**
 * Sessions: the agent sessions live now, and the context filters each is
 * in, for the Landscape to draw beside the map's items. A session is not an
 * item on the map (its facts are on the exchange); this pack reads the live
 * runs (`exchange.read`, again at each begin or end) and asks `profile.read`
 * which filters each is in, and keeps the answer in the page key
 * `sessions.live`. It writes nothing to the map.
 */
import type { RunInfo } from "../../spec/agent.ts";
import type { Id, Json } from "../../spec/common.ts";
import type { ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import type { HereDeclare, HereSet } from "../../spec/here.ts";
import type { ProfileInfo, ProfileRead } from "../../spec/profile.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { liveRuns } from "../harness/live.ts";

export const SESSIONS = "sessions.live";

/** A live session as the Landscape draws it: its run, its name, and the context filters it is in. */
export interface Session {
  run: string;
  title: string;
  filters: Id[];
}

/** How long a session that has gone quiet still counts as live, in minutes (as the Context interface's default). */
export const QUIET_MIN = 15;

/** The sessions to draw: each live run, named, with the filters it is in (by id), in the order given. */
export function sessionsOf(live: RunInfo[], placements: Map<string, ProfileInfo[]>): Session[] {
  return live.map((r) => ({
    run: r.run,
    title: r.title || r.run.slice(0, 8),
    filters: (placements.get(r.run) ?? []).map((p) => p.id),
  }));
}

const sessions: Pack = {
  id: "sessions",
  about: "The live agent sessions and the context filters each is in, for the Landscape to draw (page key sessions.live).",
  inject: ["exchange.read", "exchange.watch", "profile.read", "here.set", "here.declare"],
  apply(ctx: Context) {
    const read = ctx.get<ExchangeRead>("exchange.read");
    const live = ctx.get<ExchangeWatch>("exchange.watch");
    const profiles = ctx.get<ProfileRead>("profile.read");
    const set = ctx.get<HereSet>("here.set");
    ctx.effect(() => ctx.get<HereDeclare>("here.declare").declare({ key: SESSIONS, scope: "page", doc: "The live agent sessions and the context filters each is in (packs/sessions), for the Landscape to draw." }));

    let asked = 0, last = "";
    const update = async () => {
      const n = ++asked;
      const runs = liveRuns((await read.runs({ limit: 50 })).items, undefined, QUIET_MIN);
      const placements = new Map(await Promise.all(runs.map(async (r) => [r.run, await profiles.of(r)] as const)));
      if (n !== asked) return;
      const now = sessionsOf(runs, placements);
      const key = JSON.stringify(now);
      if (key === last) return;
      last = key;
      set.set(SESSIONS, now as unknown as Json);
    };
    const again = () => void update();
    // A session comes or goes at its begin or end; it may also change filters (profile.place begins it again).
    ctx.effect(() => live.watch({}, (e) => (e.kind === "begin" || e.kind === "end") && again()));
    ctx.effect(() => profiles.watch(again));
    // One that goes quiet stops counting as live: look again each minute.
    ctx.effect(() => {
      const t = setInterval(again, 60_000);
      return () => clearInterval(t);
    });
    again();
  },
};

export default sessions;
