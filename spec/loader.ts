/**
 * loader: the config tree, as a capability. See loader.md.
 *
 * The kernel's loader provides it (Cordis treats its loader as a plugin
 * too). Installing a plugin means trusting it: a plugin that injects this can
 * turn any plugin on or off, so the page's `page` plugin applies a person's
 * changes through it, and only actions decide what those are.
 */
import type { Capability, Dispose } from "./common.ts";

/** An entry of the config tree. */
export interface LoaderEntry {
  /** Stable: the key the tree is reconciled by. */
  id: string;
  /** The plugin module, relative to the loader's base. Absent: a group. */
  plugin?: string;
  config?: unknown;
  disabled?: boolean;
  /** A group's entries. */
  children?: LoaderEntry[];
}

/** An entry as it runs now. */
export interface LoaderStatus {
  id: string;
  /** The plugin's own id, once its module loaded. */
  plugin?: string;
  /** `off`, `waiting` (see `missing`), `failed`, `group`, or the fiber's state. */
  state: string;
  position: number[];
  missing?: string[];
  error?: string;
}

/** `loader.tree`. */
export interface LoaderTree {
  /** The tree now. */
  tree(): LoaderEntry[];
  /** The tree the host started with, before any edit. */
  base(): LoaderEntry[];
  /** Each entry: its state and its place in the tree. */
  status(): LoaderStatus[];
  /** Edits the tree and applies it: a plugin turned off unloads, a new config reloads it. */
  edit(change: (tree: LoaderEntry[]) => LoaderEntry[]): Promise<void>;
  /** Calls `on` after each change to the tree is applied. */
  watch(on: () => void): Dispose;
}

export interface Capabilities {
  "loader.tree": LoaderTree;
}

export const capabilities: Capability[] = [
  { key: "loader.tree", since: 7, doc: "The config tree: read it, watch it, edit it." },
];
