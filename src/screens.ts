// Screens as the page meets them: what the packs ship as presets, under what the owner has kept on the map. A screen
// item with a preset's id is the owner's version of it (its fields over the preset's, retired to take it away); one
// with none is the owner's own. A screen with a place in the nav is a page there; one on kinds or types is drawn on
// the page of every such item; one on Home is drawn there, after those before it. A pack's screen for Home is on it
// until the owner takes it off (home: false on their version), and can be put back. Read each time the schema is asked for, so a change shows on the next look.

import type { PieceDef, ScreenDef } from './declared.ts';
import type { Archipelago } from './pelago.ts';

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
  /** A preset the pack made for Home, on it or taken off. */
  homeable?: boolean;
}

interface Kept {
  id: string;
  title: string;
  is_open: boolean;
  props: { pieces?: PieceDef[]; on?: string[]; nav?: number | null; home?: boolean | null; preset?: string };
}

const list = <T>(v: unknown): T[] | undefined => (Array.isArray(v) && v.length ? (v as T[]) : undefined);

/** Presets overlaid by what the map keeps, in the order the packs load, then the owner's own in the order made. */
export function overlay(presets: (ScreenDef & { pack: string })[], kept: Kept[]): Screen[] {
  const byPreset = new Map(kept.filter((k) => k.props.preset).map((k) => [k.props.preset!, k]));
  const out: Screen[] = [];
  for (const p of presets) {
    const k = byPreset.get(p.id);
    if (k && !k.is_open) continue;
    out.push({
      id: p.id,
      pack: p.pack,
      title: k?.title || p.title,
      on: list<string>(k?.props.on) ?? p.on ?? [],
      pieces: list<PieceDef>(k?.props.pieces) ?? p.pieces,
      ...(typeof k?.props.nav === 'number' && { nav: k.props.nav }),
      ...(k && { item: k.id }),
      ...(p.nav && { offered: true }),
      ...((typeof k?.props.home === 'boolean' ? k.props.home : p.at === 'home') && { at: 'home' as const }),
      ...(p.at === 'home' && { homeable: true }),
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
export async function withScreens<T extends { screens: (ScreenDef & { pack: string })[] }>(l: Archipelago, described: T): Promise<Omit<T, 'screens'> & { screens: Screen[] }> {
  const { rows } = await l.db.query<Kept>(`select id, title, is_open, ${l.props} from entity where type = any($1::text[]) and archived_at is null order by created_at, id`, [l.registry.family('screen')]);
  return { ...described, screens: overlay(described.screens, rows) };
}
