/**
 * The Node host: a runtime, a loader over file URLs, and HMR.
 *
 * A resolve hook (`module.registerHooks`) records every import into the
 * module graph and puts each changed module's version into its URL, so a
 * re-import evaluates the changed modules and their importers afresh while
 * everything else stays shared. A watcher reports changed files.
 */
import { watch, type FSWatcher } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { Runtime } from "./core.ts";
import { ModuleGraph } from "./hmr.ts";
import { Loader, type Entry } from "./loader.ts";

const strip = (url: string) => url.split("?")[0]!;

/** The one graph of this process: hooks are process-wide. */
export const graph = new ModuleGraph();
let hooked = false;

function hook(): void {
  if (hooked) return;
  hooked = true;
  registerHooks({
    resolve(specifier, context, next) {
      const r = next(specifier, context);
      if (!r.url.startsWith("file:")) return r;
      const url = strip(r.url);
      if (context.parentURL?.startsWith("file:")) graph.record(strip(context.parentURL), url);
      return { ...r, url: graph.versioned(url) };
    },
  });
}

/** The runtime's own modules: a change to one needs a restart. */
const RUNTIME = strip(new URL("./", import.meta.url).href);
export const declinedByDefault = (url: string) => url.startsWith(RUNTIME) || url.includes("/node_modules/");

export interface NodeHostOptions {
  /** The config tree. */
  tree: Entry[];
  /** What entry urls resolve against: a directory's file URL, ending in `/`. */
  base: string;
  /** A directory to watch for changes; HMR is off without it. */
  watch?: string;
  declined?: (url: string) => boolean;
  /** Told what each change did. */
  onReload?: (result: HotResult) => void;
}

export interface HotResult {
  changed: string[];
  reloaded: string[];
  /** Declined modules the change reached: a restart is needed for them. */
  restart: string[];
  error?: unknown;
}

export class NodeHost {
  readonly runtime = new Runtime();
  readonly loader: Loader;
  private watcher?: FSWatcher;
  private options: NodeHostOptions;

  constructor(options: NodeHostOptions) {
    hook();
    this.options = options;
    this.loader = new Loader(this.runtime, {
      base: options.base,
      import: (url) => import(graph.versioned(strip(url))),
    });
  }

  async start(): Promise<this> {
    // A host starts from the files as they are now, not from instances an
    // earlier host in this process left in Node's cache.
    const declined = this.options.declined ?? declinedByDefault;
    graph.bump(graph.modules().filter((u) => !declined(u)));
    await this.loader.apply(this.options.tree);
    if (this.options.watch) this.watch(this.options.watch);
    return this;
  }

  /**
   * Hot-reloads after `files` changed (file URLs or paths): the modules the
   * change reaches get new versions, and the entries built on them are
   * rebuilt (Algorithms 8 to 10).
   */
  async hot(files: Iterable<string>): Promise<HotResult> {
    const changed = [...files].map((f) => (f.startsWith("file:") ? f : pathToFileURL(f).href)).filter((u) => graph.has(u));
    const { accepted, declined } = graph.classify(changed, this.options.declined ?? declinedByDefault);
    graph.bump(accepted);
    const result: HotResult = { changed, reloaded: [], restart: [...declined] };
    try {
      result.reloaded = await this.loader.reload(accepted);
    } catch (error) {
      result.error = error;
      this.runtime.onError(this.runtime.rootFiber, error);
    }
    this.options.onReload?.(result);
    return result;
  }

  private watch(dir: string): void {
    let pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const root = pathToFileURL(dir.endsWith("/") || dir.endsWith("\\") ? dir : `${dir}/`);
    this.watcher = watch(dir, { recursive: true }, (_event, name) => {
      if (!name) return;
      pending.add(new URL(name.replaceAll("\\", "/"), root).href);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const files = pending;
        pending = new Set();
        void this.hot(files);
      }, 50);
    });
  }

  async stop(): Promise<void> {
    this.watcher?.close();
    await this.loader.apply([]);
  }
}
