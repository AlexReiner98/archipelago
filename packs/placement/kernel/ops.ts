// What the placement pack reads of a change and the map, as plain shapes: the ops it is handed (the kernel's, of which
// it reads only these fields), the registry the change is judged by, and an item or a link as the reads answer them.

import type { KernelContext } from '#pelago/kernel';

type Props = Record<string, unknown>;
type Visibility = 'private' | 'shared' | 'public';

export type Op =
  | { op: 'create'; ref?: string; type: string; title: string; visibility?: Visibility; props?: Props }
  | { op: 'update'; id: string; status?: string; visibility?: Visibility; props?: Props }
  | { op: 'link'; type: string; from: string; to: string; props?: Props }
  | { op: 'unlink'; relation: string }
  | { op: 'archive' | 'restore' | 'forget'; id: string }
  | { op: 'merge'; keep: string; drop: string }
  | { op: 'define_type'; type: unknown };

/** A type as the pack reads it. */
export interface Type { id: string; pack?: string; system: boolean; lineage: string[]; capabilities: { subject?: { link: string } } }

/** The registry a change is judged by, as the pack reads it: the map's, or an island's where that differs. */
export interface Reg {
  readonly onIslands: boolean;
  types: ReadonlyMap<string, { id: string }>;
  relations: ReadonlyMap<string, { id: string }>;
  packs: readonly { id: string; shared?: string[] }[];
  type(id: string): Type | undefined;
  isA(type: string, kind: string): boolean;
  relationFamily(...roots: string[]): string[];
}

/** What the write path hands a rewrite beside the ops (packs/write/kernel/write-hooks.ts, Judged): the registry the change is judged by, and the island it was given. */
export interface Judged { registry: Reg; island?: string }

/** An item as the reads answer it (`ids`). */
export interface Item { id: string; type: string; title: string; visibility: string; archived_at: unknown; props?: Props }
/** An open link as the reads answer it (`links`). */
export interface Link { id: string; type: string; from_id: string; to_id: string }

/** One item by id as the asker may read it, archived too; none when it is not there or not theirs to see. */
export const itemOf = async (ctx: KernelContext, id: string): Promise<Item | undefined> => ((await ctx.reads({ ids: [id] })) as Item[])[0];
