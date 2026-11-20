/**
 * `mcp.maps`: other maps the `get` and `query` tools can read, by name,
 * beside the living one. The mcp pack provides it; a pack that holds a map
 * nobody writes (an old map kept as an archive, packs/archive) adds it, as
 * its effect. Read only: there is no way to write through it.
 *
 * A pack-own key, like `mcp.host`.
 */
import type { Dispose, Id, Page, PageRequest } from "../../spec/common.ts";
import type { Direction, Item, Link } from "../../spec/graph.ts";

export const MAPS = "mcp.maps";

/** A map's reads: the graph's bounded ones, and every item a page at a time. */
export interface MapRead {
  get(ids: Id[]): Promise<(Item | null)[]>;
  links(id: Id, opts: { type?: string; dir: Direction }, page?: PageRequest): Promise<Page<Link>>;
  /** Every item and link, in a stable order. */
  all(page?: PageRequest): Promise<Page<Item>>;
}

export interface MapDef {
  /** Short and unique: what `map` names it by. */
  name: string;
  /** One line on what it is. */
  title?: string;
  read: MapRead;
}

export interface McpMaps {
  /** Adds a map, as the calling pack's; a taken name is refused. */
  add(map: MapDef): Dispose;
}
