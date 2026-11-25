/**
 * The way into the Context interface from a context filter itself: on its item page (the item plugin's
 * `item.actions` slot), a button that opens the filter's view. With a session live in the filter it opens the
 * live view focused on that session; with none, the filter's own tree (every node it gives).
 */
import { h } from "preact";
import htm from "htm";
import type { HereSet } from "../../spec/here.ts";
import { KEYS } from "../../spec/here.ts";
import type { RunInfo } from "../../spec/agent.ts";
import type { Item } from "../../spec/graph.ts";
import type { Json } from "../../spec/common.ts";
import { ALL, FOCUS, LIVE, PROFILE } from "./hooks.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** A context filter's type on the map (plugins/profile): the button shows on its items only. */
export const CONTEXT_FILTER = "context_filter";

/** The Context interface's view, as the frame names it in `here.view`. */
export const VIEW = "harness/view";

/** What opening a filter's view sets, in order: the live view on its first live session, else its own tree. */
export function openFilter(filter: string, liveIn: readonly string[]): [string, Json | undefined][] {
  return liveIn.length
    ? [[KEYS.event, undefined], [PROFILE, undefined], [ALL, undefined], [LIVE, true], [FOCUS, liveIn[0]], [KEYS.view, VIEW]]
    : [[KEYS.event, undefined], [LIVE, undefined], [PROFILE, filter], [ALL, true], [KEYS.view, VIEW]];
}

/** The item page's button: only on a context filter. */
export function OpenFilterButton(deps: {
  set: HereSet;
  type: string;
  useHere<T extends Json>(key: string): T | undefined;
  useItem(id?: string): Item | null;
  useLive(): RunInfo[];
  useRunsIn(runs: RunInfo[], profile: string | undefined): RunInfo[] | undefined;
}) {
  return () => {
    const id = deps.useHere<string>(KEYS.item);
    const item = deps.useItem(id);
    const live = deps.useLive();
    const inIt = deps.useRunsIn(live, item?.type === deps.type ? id : undefined) ?? [];
    if (!id || item?.type !== deps.type) return null;
    const runs = inIt.map((r) => r.run);
    const go = () => {
      for (const [k, v] of openFilter(id, runs)) deps.set.set(k, v);
    };
    const what = runs.length ? `Watch ${runs.length === 1 ? "its live session" : `its ${runs.length} live sessions`}` : "Its context";
    return html`<button class="ip-btn ip-open" title="Open this context filter's view in the Context interface" onClick=${go}>${what} in the Context interface ›</button>`;
  };
}
