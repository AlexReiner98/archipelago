// Screens as the page meets them: what the packs ship as presets, under what the owner has kept on the map. A screen
// item with a preset's id is the owner's version of it (its fields over the preset's, retired to take it away); one
// with none is the owner's own. A screen with a place in the nav is a page there; one on kinds or types is drawn on
// the page of every such item; one on Home is drawn there, after those before it. The map's start page (a screen that
// declares start: practice's For you) is on Home from the start, drawn first. Any other pack's screen for Home is on it
// once the workspace holds something of that pack's types, until the owner takes it off (home: false on their
// version), and can be put back; the owner putting it there (home: true) needs no such thing. Read each time the schema is asked for, so a change shows on the next look.

import type { KernelContext } from '#pelago/kernel';

/** A piece of a screen, as a pack declares it (src/declared.ts, PieceDef): what is drawn, and what it is told. */
export interface PieceDef {
  piece: string;
}

/** A screen a pack ships (src/declared.ts, ScreenDef). */
export interface ScreenDef {
  id: string;
  title: string;
  on?: string[];
  nav?: boolean;
  at?: 'home';
  start?: boolean;
  pieces: PieceDef[];
}

export interface Screen {
  /** The preset's id, or the screen item's when it is the owner's own. */
  id: string;
  /** The screen item that holds the owner's version, if there is one. */
  item?: string;
  /** The pack it came from, for a preset. */
  pack?: string;
  title: string;
  on: string[];
  pieces: PieceDef[];
  /** Its place in the nav; none when it is not there. */
  nav?: number;
  /** A preset the pack offers for the nav. */
  offered?: boolean;
  /** One of the kernel's own pages it is drawn on: Home. */
  at?: 'home';
  /** The map's start page (a preset that declares start): drawn first on Home. */
  start?: boolean;
  /** A preset the pack made for Home, on it or taken off. */
  homeable?: boolean;
  /** A preset for Home whose pack nothing here uses yet: it waits for the first such item. */
  idle?: boolean;
}

interface Kept {
  id: string;
  title: string;
  is_open: boolean;
  props: { pieces?: PieceDef[]; on?: string[]; nav?: number | null; home?: boolean | null; preset?: string };
}

const list = <T>(v: unknown): T[] | undefined => (Array.isArray(v) && v.length ? (v as T[]) : undefined);

/** Presets overlaid by what the map keeps, in the order the packs load, then the owner's own in the order made. Used: the packs the map holds anything of (all, when not said). */
export function overlay(presets: (ScreenDef & { pack: string })[], kept: Kept[], used?: Set<string>): Screen[] {
  const byPreset = new Map(kept.filter((k) => k.props.preset).map((k) => [k.props.preset!, k]));
  const out: Screen[] = [];
  for (const p of presets) {
    const k = byPreset.get(p.id);
    if (k && !k.is_open) continue;
    const idle = p.at === 'home' && !p.start && used !== undefined && !used.has(p.pack);
    // Home is the owner's move (docs/ui-strategy.md): only the map's start page is on it until the owner adds another.
    const home = typeof k?.props.home === 'boolean' ? k.props.home : p.at === 'home' && p.start === true;
    out.push({
      id: p.id,
      pack: p.pack,
      title: k?.title || p.title,
      on: list<string>(k?.props.on) ?? p.on ?? [],
      pieces: list<PieceDef>(k?.props.pieces) ?? p.pieces,
      ...(typeof k?.props.nav === 'number' && { nav: k.props.nav }),
      ...(k && { item: k.id }),
      ...(p.nav && { offered: true }),
      ...(home && { at: 'home' as const }),
      ...(p.at === 'home' && { homeable: true }),
      ...(p.at === 'home' && p.start && { start: true }),
      ...(idle && !home && { idle: true }),
    });
  }
  const known = new Set(presets.map((p) => p.id));
  for (const k of kept) {
    if (!k.is_open || (k.props.preset && known.has(k.props.preset))) continue;
    const pieces = list<PieceDef>(k.props.pieces);
    // The owner's version of a preset whose pack is not here has nothing to draw until it is.
    if (!pieces) continue;
    out.push({ id: k.id, item: k.id, title: k.title, on: list<string>(k.props.on) ?? [], pieces, ...(typeof k.props.nav === 'number' && { nav: k.props.nav }), ...(k.props.home === true && { at: 'home' as const }) });
  }
  return out;
}

/** The schema as the registry describes it, with its screens as the asker's map keeps them. */
export async function withScreens<T extends { screens: (ScreenDef & { pack: string })[] }>(ctx: KernelContext, described: T): Promise<Omit<T, 'screens'> & { screens: Screen[] }> {
  const { types } = ctx.registry;
  const rows = (await ctx.reads({ screens: true })) as Kept[];
  // Which types hold anything: one look each, by the index on type, not a read of every item.
  const held = (await ctx.reads({ held_types: [...types.keys()] })) as string[];
  const used = new Set(held.flatMap((type) => (types.get(type)?.lineage ?? []).map((t) => types.get(t)!.pack)));
  return { ...described, screens: overlay(described.screens, rows, used) };
}
