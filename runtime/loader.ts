/**
 * The loader (Cordis §5.2): a config tree the orchestrator edits, realised
 * as fibers and kept in step with them.
 *
 * - An entry names a plugin module, its config, whether it is disabled, and
 *   the interception metadata its context carries. An entry without a plugin
 *   is a group: its children inherit `disabled` and `intercept`.
 * - Applying a tree reconciles by id and changes each fiber the least it
 *   can: a new url rebuilds it, a new config reloads it, `disabled` unloads
 *   or loads it, `intercept` updates in place, a move only changes order.
 * - Order: an entry's position is its path of indices from the root, read
 *   live, so every broker orders contributions by the tree (`byPosition`).
 * - HMR (§5.2.2, Algorithm 10): `reload` re-imports changed modules first
 *   and swaps fibers only if every import succeeded.
 *
 * Isomorphic: the host gives it `import`. It provides `loader.tree`
 * (spec/loader.md) on the runtime's root, so a plugin can edit the tree too.
 */
import type { LoaderTree } from "../spec/loader.ts";
import type { Context, Fiber, Meta, Plugin, Runtime, State } from "./core.ts";

export interface Entry {
  /** Stable: the key the tree is reconciled by. */
  id: string;
  /** The plugin module's URL, relative to the loader's base. Absent: a group. */
  plugin?: string;
  config?: unknown;
  disabled?: boolean;
  /** Interception metadata for its context (`actor`, `run`, …). */
  intercept?: Meta;
  /** A group's entries. */
  children?: Entry[];
}

export interface LoaderOptions {
  /** What entry urls resolve against. */
  base: string;
  /** Imports a plugin module. The host decides how a changed module is fetched fresh. */
  import(url: string): Promise<unknown>;
}

export interface EntryStatus {
  id: string;
  plugin?: string;
  /**
   * `off`: disabled in the tree. `waiting`: on, but a capability it injects
   * isn't provided (see `missing`). `failed`: its import or apply threw.
   * Otherwise its fiber's state.
   */
  state: State | "off" | "waiting" | "group";
  position: number[];
  /** What a waiting entry waits for. */
  missing?: string[];
  error?: string;
}

interface Node {
  entry: Entry;
  url?: string;
  path: number[];
  disabled: boolean;
  meta: Meta;
  fiber?: Fiber;
  error?: unknown;
}

interface Planned {
  entry: Entry;
  url?: string;
  path: number[];
  disabled: boolean;
  meta: Meta;
}

/** The plugin a module exports. */
export function pluginOf(mod: unknown, url: string): Plugin {
  const m = mod as { default?: unknown };
  const plugin = (m && typeof m === "object" && "default" in m ? m.default : mod) as Plugin;
  if (!plugin || typeof plugin.id !== "string" || typeof plugin.apply !== "function") {
    throw new Error(`${url} does not export a plugin (an object with id and apply)`);
  }
  return plugin;
}

/** The tree's entries copied, configs shared: a config may hold functions, which can't be cloned. */
const copy = (tree: Entry[]): Entry[] => tree.map((e) => ({ ...e, ...(e.children ? { children: copy(e.children) } : {}) }));

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export class Loader {
  readonly runtime: Runtime;
  readonly options: LoaderOptions;
  tree: Entry[] = [];
  /** The first tree applied: the host's template. */
  private first?: Entry[];
  private watchers = new Set<() => void>();
  private nodes = new Map<string, Node>();
  /** One apply or reload at a time. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(runtime: Runtime, options: LoaderOptions) {
    this.runtime = runtime;
    this.options = options;
    runtime.root.provide<LoaderTree>("loader.tree", (_caller, from) => ({
      tree: () => copy(this.tree),
      base: () => copy(this.first ?? this.tree),
      status: () => this.status(),
      edit: (change) => this.edit(change as (t: Entry[]) => Entry[]),
      watch: (on) =>
        from.effect(() => {
          this.watchers.add(on);
          return () => void this.watchers.delete(on);
        }),
    }));
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => {});
    return next;
  }

  url(plugin: string): string {
    return new URL(plugin, this.options.base).href;
  }

  private plan(tree: Entry[]): Map<string, Planned> {
    const out = new Map<string, Planned>();
    const walk = (entries: Entry[], path: number[], disabled: boolean, meta: Meta) => {
      entries.forEach((entry, i) => {
        if (out.has(entry.id)) throw new Error(`config tree: the id ${entry.id} is used twice`);
        const p = { entry, path: [...path, i], disabled: disabled || !!entry.disabled, meta: { ...meta, ...entry.intercept } };
        out.set(entry.id, { ...p, url: entry.plugin ? this.url(entry.plugin) : undefined });
        if (entry.children) walk(entry.children, p.path, p.disabled, p.meta);
      });
    };
    walk(tree, [], false, {});
    return out;
  }

  /**
   * Makes the running system match `tree`. Modules are imported together;
   * dependencies decide when each fiber activates, not the order here.
   */
  apply(tree: Entry[]): Promise<void> {
    return this.serial(() => this.reconcile(tree));
  }

  private async reconcile(tree: Entry[]): Promise<void> {
    const plan = this.plan(tree);
    const leaving: Promise<void>[] = [];
    for (const [id, node] of this.nodes) {
      const next = plan.get(id);
      if (!next || next.url !== node.url) {
        if (node.fiber) leaving.push(Promise.resolve(node.fiber.dispose()));
        this.nodes.delete(id);
      }
    }
    await Promise.all(leaving);

    const fresh = [...plan.values()].filter((p) => !this.nodes.has(p.entry.id));
    const imported = await Promise.allSettled(
      fresh.map((p) => (p.url ? this.options.import(p.url).then((m) => pluginOf(m, p.url!)) : Promise.resolve(undefined))),
    );

    const changes: Promise<void>[] = [];
    for (const [id, node] of this.nodes) {
      const next = plan.get(id)!;
      const was = node.entry;
      node.entry = next.entry;
      node.path = next.path;
      if (!same(node.meta, next.meta)) {
        node.meta = next.meta;
        // Interception is read at call time: no reload.
        if (node.fiber) node.fiber.ctx.meta = { all: { ...next.meta }, keys: node.fiber.ctx.meta.keys };
      }
      if (!node.fiber) continue;
      if (!same(was.config, next.entry.config)) changes.push(node.fiber.update(next.entry.config));
      if (node.disabled !== next.disabled) {
        node.disabled = next.disabled;
        changes.push(node.fiber.setDisabled(next.disabled));
      }
    }

    fresh.forEach((p, i) => {
      const node: Node = { entry: p.entry, url: p.url, path: p.path, disabled: p.disabled, meta: p.meta };
      this.nodes.set(p.entry.id, node);
      const r = imported[i]!;
      if (r.status === "rejected") {
        node.error = r.reason;
        this.runtime.onError(this.runtime.rootFiber, r.reason);
      } else if (r.value) {
        node.fiber = this.instantiate(node, r.value);
      }
    });

    this.tree = tree;
    this.first ??= copy(tree);
    // A move changes which provider is first: let every fiber look again.
    this.runtime.reorder();
    await Promise.all(changes);
    await this.runtime.settle();
    for (const on of [...this.watchers]) {
      try {
        on();
      } catch (err) {
        this.runtime.onError(this.runtime.rootFiber, err);
      }
    }
  }

  private instantiate(node: Node, plugin: Plugin): Fiber {
    const ctx: Context = this.runtime.root.intercept(node.meta);
    const fiber = ctx.plugin(plugin, node.entry.config, { position: () => node.path, disabled: node.disabled, source: node.url });
    return fiber;
  }

  /**
   * Hot reload (Algorithm 10): the entries whose module is in `urls` are
   * rebuilt from a fresh import. Every module is imported before any fiber
   * is touched, so a module that fails to import leaves the system as it
   * was, and the error is thrown.
   */
  reload(urls: Iterable<string>): Promise<string[]> {
    const set = new Set(urls);
    return this.serial(async () => {
      const stale = [...this.nodes.values()].filter((n) => n.url && set.has(n.url));
      const plugins = await Promise.all(stale.map((n) => this.options.import(n.url!).then((m) => pluginOf(m, n.url!))));
      await Promise.all(stale.map((n) => n.fiber?.dispose()));
      stale.forEach((n, i) => {
        n.error = undefined;
        n.fiber = this.instantiate(n, plugins[i]!);
      });
      await this.runtime.settle();
      return stale.map((n) => n.entry.id);
    });
  }

  /** Edits the tree and applies it. */
  edit(change: (tree: Entry[]) => Entry[]): Promise<void> {
    // Copied, configs shared: a server config holds functions, which structuredClone refuses.
    return this.serial(() => this.reconcile(change(copy(this.tree))));
  }

  fiber(id: string): Fiber | undefined {
    return this.nodes.get(id)?.fiber;
  }

  /** Each entry: its state, its place in the tree, and why it failed. */
  status(): EntryStatus[] {
    return [...this.nodes.values()]
      .sort((a, b) => {
        for (let i = 0; i < Math.min(a.path.length, b.path.length); i++) {
          const d = a.path[i]! - b.path[i]!;
          if (d) return d;
        }
        return a.path.length - b.path.length;
      })
      .map((n): EntryStatus => {
        const error = n.error ?? n.fiber?.error;
        const f = n.fiber;
        const missing = f && f.state === "inactive" && !n.disabled ? f.missing() : [];
        const state: EntryStatus["state"] = !n.url
          ? "group"
          : !f
            ? "failed"
            : n.disabled && f.state === "inactive"
              ? "off"
              : missing.length
                ? "waiting"
                : f.state;
        return {
          id: n.entry.id,
          plugin: f?.plugin.id,
          state,
          position: n.path,
          ...(missing.length ? { missing } : {}),
          ...(error ? { error: String((error as Error).message ?? error) } : {}),
        };
      });
  }
}

/** Helpers for `edit`: find an entry and the list it sits in. */
export function locate(tree: Entry[], id: string): { list: Entry[]; index: number } | undefined {
  for (let i = 0; i < tree.length; i++) {
    if (tree[i]!.id === id) return { list: tree, index: i };
    const inner = tree[i]!.children && locate(tree[i]!.children!, id);
    if (inner) return inner;
  }
  return undefined;
}

/** Moves an entry to `index` in the group `parent` (null: the root). */
export function move(tree: Entry[], id: string, parent: string | null, index: number): Entry[] {
  const at = locate(tree, id);
  if (!at) throw new Error(`no entry ${id}`);
  const [entry] = at.list.splice(at.index, 1);
  const into = parent === null ? tree : locate(tree, parent);
  const list = Array.isArray(into) ? into : into && (into.list[into.index]!.children ??= []);
  if (!list) throw new Error(`no group ${parent}`);
  list.splice(index, 0, entry!);
  return tree;
}
