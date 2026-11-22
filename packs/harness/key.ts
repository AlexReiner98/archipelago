/**
 * The tree's key, and the size of a channel's shape. The key lists the
 * marks; with a filter, its "show" rows (the map's, Claude Code's, each
 * channel) hide and show those nodes with a click.
 */
import { h } from "preact";
import htm from "htm";
import { v } from "../../spec/style.ts";
import type { NodeInfo } from "../../spec/agent.ts";
import { CHANNELS, channelOf, isHarness, shapePath, type Filter } from "./channels.ts";

/**
 * The marks the tree in sight shows, so the key lists only those: a new
 * user's key is short, and one with profiles, verdicts and trials grows as
 * they appear. Ids: `said`, `refused`, `acted` (the run did something),
 * `held`, `shadow` (holds), `v-held`, `v-failed`, `v-quiet` (verdict rings),
 * `trial`, `unused` (a given tool or server no run used), the filters (`map`, `harness`, each channel: there, or hidden
 * now, so a click can bring them back), `pack:<id>` for each pack's hue,
 * and the window's marks at the playhead (`w-in`, `w-listed`, `w-dropped`).
 */
export function marksIn(p: {
  nodes: NodeInfo[];
  heard: ReadonlyMap<string, string>;
  held: ReadonlyMap<string, string>;
  rings?: ReadonlyMap<string, string>;
  trial(n: NodeInfo): boolean;
  off?: ReadonlySet<string>;
  /** Each node's place in the window at the playhead (windowbar.ts). */
  window?: ReadonlyMap<string, string>;
}): Set<string> {
  const out = new Set<string>(p.off ?? []);
  for (const m of p.window?.values() ?? []) out.add(`w-${m}`);
  for (const h of p.heard.values()) out.add(h);
  if (p.heard.size) out.add("acted");
  for (const h of p.held.values()) out.add(h);
  for (const r of p.rings?.values() ?? []) out.add(`v-${r}`);
  for (const n of p.nodes) {
    out.add(isHarness(n) ? "harness" : "map");
    out.add(channelOf(n));
    if (!isHarness(n)) out.add(`pack:${n.pack}`);
    if (p.trial(n)) out.add("trial");
    // A given tool or server: never used across runs; one a lean profile would leave out (packs/harness/use.ts).
    const g = n as NodeInfo & { use?: { used: number }; out?: { applied: boolean } };
    if (g.use?.used === 0) out.add("unused");
    if (g.out) out.add(g.out.applied ? "held" : "shadow");
  }
  return out;
}

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/**
 * How big a channel's shape is drawn, in the picture's units, for a dot of
 * radius `r` at zoom `k`: this much bigger than a plain dot, up to
 * SHAPE_MOST, short of the name's gap; and never under SHAPE_SCREEN pixels
 * on screen, so circle, diamond, square and triangle read apart however far
 * the tree is zoomed out. A small tree (a preview) draws it at SHAPE_SMALL,
 * or SMALL_SCREEN pixels.
 */
export const SHAPE_GROW = 1.6;
export const SHAPE_MOST = 6;
export const SHAPE_SCREEN = 4;
export const SHAPE_SMALL = 5;
export const SMALL_SCREEN = 2;

export function shapeRadius(r: number, k: number, small: boolean): number {
  const zoom = k > 0 ? k : 1;
  return small ? Math.max(SHAPE_SMALL, SMALL_SCREEN / zoom) : Math.max(Math.min(r * SHAPE_GROW, SHAPE_MOST), SHAPE_SCREEN / zoom);
}

const KeyRow = (mark: unknown, text: string, tip?: string) => html`${mark}<span title=${tip ?? ""}>${text}</span>`;

/** The key as a filter: what it hides, and a click on a row hides or shows it. */
export interface KeyFilter {
  off: ReadonlySet<string>;
  onToggle(f: Filter): void;
  /** Sets what is hidden at once, from what is hidden now: the window bar's click shows only one share. */
  set?(next: (off: ReadonlySet<string>) => Set<string>): void;
}

/** A row of the key that filters: its mark and words, struck while hidden. */
const FilterRow = (f: Filter, mark: unknown, text: string, filter?: KeyFilter) => {
  if (!filter) return KeyRow(mark, text);
  const off = filter.off.has(f);
  const flip = (e: Event) => {
    e.stopPropagation();
    filter.onToggle(f);
  };
  return html`<button class=${`rx-krow${off ? " off" : ""}`} title=${off ? "Hidden: show it again" : "Hide these from the tree"} onPointerDown=${(e: Event) => e.stopPropagation()} onClick=${flip}>${mark}<span>${text}</span></button>`;
};

/** The marks a filter can hide: who it is from, then each channel. Shared by the open key and the collapsed one. */
const FILTERS = (): { f: Filter; mark: unknown; text: string }[] => [
  { f: "map", mark: html`<svg viewBox="0 0 14 10"><path d="M1 5H8" style=${`stroke:${v("say")};stroke-width:2`} /><circle cx="10" cy="5" r="3" style=${`fill:${v("owner")}`} /></svg>`, text: "the map's: what we supply" },
  { f: "harness", mark: html`<svg viewBox="0 0 14 10"><path d="M1 5H8" style=${`stroke:${v("harness")};stroke-width:2`} /><circle cx="10" cy="5" r="3" style=${`fill:${v("harness")}`} /></svg>`, text: "orange: Claude Code gave it" },
  ...CHANNELS.map((c) => ({ f: c.channel as Filter, mark: html`<svg viewBox="0 0 14 10"><path transform="translate(7 5)" d=${shapePath(c.shape, 3.6)} style=${`fill:${v("dim")}`} /></svg>`, text: `${c.title}: ${c.key}` })),
];

const stop = (e: Event) => e.stopPropagation();

/**
 * The key, never gone: open, every mark with its words; or collapsed to one
 * line of the marks that filter, each still a click to hide or show. Its
 * head opens or collapses it (`onOpen`).
 */
export const Key = ({ hues, filter, open = true, onOpen, present }: { hues: Map<string, string>; filter?: KeyFilter; open?: boolean; onOpen?(open: boolean): void; present?: ReadonlySet<string> }) => {
  // Only the marks the tree shows (`marksIn`); given no `present`, every mark.
  const has = (id: string) => !present || present.has(id);
  const filters = FILTERS().filter(({ f }) => has(f));
  const row = (id: string, mark: unknown, text: string, tip?: string) => (has(id) ? KeyRow(mark, text, tip) : "");
  const head = onOpen && html`<button class="rx-khead" title=${open ? "Collapse the key to one line" : "Open the key"} onPointerDown=${stop} onClick=${(e: Event) => (stop(e), onOpen(!open))}>key ${open ? "▾" : "▸"}</button>`;
  if (!open)
    return html`<div class="rx-key closed filters">
      ${head}
      ${filters.map(({ f, mark, text }) => {
        const off = !!filter?.off.has(f);
        return html`<button class=${`rx-kmark${off ? " off" : ""}`} title=${`${text}${filter ? (off ? "\nHidden: a click shows it" : "\nA click hides it") : ""}`} onPointerDown=${stop} onClick=${(e: Event) => (stop(e), filter?.onToggle(f))}>${mark}</button>`;
      })}
    </div>`;
  const said = [
    row("said", html`<svg viewBox="0 0 14 10"><path class="rx-trail k-say" d="M1 5H13" style="stroke-opacity:1" /></svg>`, "said to the agent", "The map told the agent this node, at the moment it lit up"),
    row("refused", html`<svg viewBox="0 0 14 10"><path class="rx-trail k-fail" d="M1 5H13" style="stroke-opacity:1" /></svg>`, "refused · failed", "A rule stopped a step, or something the agent did failed"),
    row("acted", html`<svg viewBox="0 0 14 10"><circle class="k-write" cx="7" cy="5" r="4" /></svg>`, "the agent acted here", "A tool call or a reply, sparking on the bough of its place"),
    row("held", html`<svg viewBox="0 0 14 10"><circle cx="7" cy="5" r="3" style=${`fill:${v("fg")};opacity:.38`} /></svg>`, "held back by a profile", "A profile kept this node from this agent: it wasn't said"),
    row("shadow", html`<svg viewBox="0 0 14 10"><circle cx="7" cy="5" r="3" style=${`fill:${v("fg")};stroke:${v("dim")};stroke-dasharray:1.5 1;stroke-width:1.2`} /></svg>`, "a trial profile would hold", "A profile being tried out would have held it back; it was still said"),
  ];
  const judged = [
    row("v-held", html`<svg viewBox="0 0 14 10"><circle class="rx-ring v-held" cx="7" cy="5" r="3.5" /></svg>`, "held", "Said, and nothing went wrong that it covers"),
    row("v-failed", html`<svg viewBox="0 0 14 10"><circle class="rx-ring v-failed" cx="7" cy="5" r="3.5" /></svg>`, "failed", "Said, and a miss it covers followed"),
    row("v-quiet", html`<svg viewBox="0 0 14 10"><circle class="rx-ring v-quiet" cx="7" cy="5" r="3.5" /></svg>`, "quiet", "Said, with nothing to judge it by"),
    row("trial", html`<svg viewBox="0 0 14 10"><circle cx="7" cy="5" r="3" style=${`fill:none;stroke:${v("fg")};stroke-width:1.2`} /></svg>`, "trial node", "Written after a miss, not yet kept or retired"),
    row("unused", html`<svg viewBox="0 0 14 10"><circle cx="7" cy="5" r="3" style=${`fill:${v("harness")};fill-opacity:.15;stroke:${v("harness")};stroke-width:1.2`} /></svg>`, "given, never used", "Claude Code gave this tool or server, and no run counted used it"),
  ];
  const inWindow = [
    row("w-in", html`<svg viewBox="0 0 14 10"><circle class="rx-win w-in" cx="7" cy="5" r="4.5" /><circle cx="7" cy="5" r="2" style=${`fill:${v("fg")}`} /></svg>`, "in the window now", "Said, or there from the start, and not dropped since: the agent has it in mind at the playhead"),
    row("w-listed", html`<svg viewBox="0 0 14 10"><circle class="rx-win w-listed" cx="7" cy="5" r="4" /><circle cx="7" cy="5" r="2" style=${`fill:${v("fg")}`} /></svg>`, "only named in a listing", "Only its name is in the window, in a listing: the skill or tool itself loads when it is used"),
    row("w-dropped", html`<svg viewBox="0 0 14 10"><circle cx="7" cy="5" r="2" style=${`fill:${v("fg")}`} /><path class="rx-win w-dropped" d="M3 9L11 1" /></svg>`, "dropped by a compaction", "Said before the last compaction and not again since: gone from the window"),
  ];
  const from = filters.filter(({ f }) => f === "map" || f === "harness");
  const how = filters.filter(({ f }) => f !== "map" && f !== "harness");
  const packs = [...hues].filter(([p]) => has(`pack:${p}`));
  return html`
  <div class=${`rx-key${filter || onOpen ? " filters" : ""}`}>
    ${head && html`<span class="rx-kfull">${head}</span>`}
    ${section("in this run", "What happened in the run looked at, as it lights the tree", said)}
    ${section("in the window", "At the playhead, or live: what the agent has in its context window (the window bar over the tree)", inWindow)}
    ${section("judged", "Each node's verdict once the run ends, and nodes still on trial", judged)}
    ${section("from", "Who supplies it: the map, or Claude Code itself. A click hides or shows", from.map(({ f, mark, text }) => FilterRow(f, mark, text, filter)))}
    ${section("how it reaches the agent", "The dot's shape: the channel it comes through. A click hides or shows", how.map(({ f, mark, text }) => FilterRow(f, mark, text, filter)))}
    ${section("made by", "The dot's colour: the pack that made the map's node", packs.map(([p, c]) => KeyRow(html`<svg viewBox="0 0 14 10"><circle cx="7" cy="5" r="3.5" style=${`fill:${c}`} /></svg>`, packName(p), PACKS[p]?.[1] ?? `The ${p} pack`)))}
  </div>
`;
};

/** A titled part of the key, over a line; nothing when it has no rows. */
function section(title: string, tip: string, rows: unknown[]) {
  const shown = rows.filter((r) => r !== "");
  if (!shown.length) return "";
  return html`<span class="rx-ksec" title=${tip}>${title}</span>${shown}`;
}

/** The packs whose nodes the key names, in plain words, with what they do. Any other is named by its id. */
const PACKS: Record<string, [string, string]> = {
  words: ["the map's words", "Words written on the map, said where they are placed"],
  grow: ["learned from a miss", "Trial nodes the learning loop wrote after an agent stumbled"],
  loaded: ["skills & memory loaded", "The skill and memory files Claude Code loaded into the run"],
  since: ["what changed since", "Since you last heard: at each prompt, what a person changed on the map since the last one"],
  schema: ["type rules", "The schema's refusals: an item that doesn't fit its type"],
  written: ["files the map writes", "Skills and memory files the map writes for agents to load"],
  keep: ["kept or retired", "Trial nodes the keep pack kept or retired by their record"],
};
export const packName = (p: string) => PACKS[p]?.[0] ?? p;
