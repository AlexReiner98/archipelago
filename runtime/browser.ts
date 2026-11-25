/**
 * The browser host: the same runtime and loader, importing plugin modules
 * from the dev server and hot-reloading them when it says they changed.
 */
import { Runtime } from "./core.ts";
import { Loader, type Entry } from "./loader.ts";

export interface BrowserHost {
  runtime: Runtime;
  loader: Loader;
  /** Called after each hot reload with the entries it rebuilt. */
  onReload?: (reloaded: string[], restart: string[]) => void;
  stop(): Promise<void>;
}

export async function startBrowser(options: { tree: Entry[]; base?: string; hmr?: string | false }): Promise<BrowserHost> {
  const runtime = new Runtime();
  const versions = new Map<string, number>();
  const versioned = (url: string) => {
    const v = versions.get(new URL(url).pathname);
    return v ? `${url}?v=${v}` : url;
  };
  const loader = new Loader(runtime, {
    base: options.base ?? location.href,
    import: (url) => import(/* @vite-ignore */ versioned(url)),
  });
  const host: BrowserHost = {
    runtime,
    loader,
    stop: async () => {
      events?.close();
      await loader.apply([]);
    },
  };
  await loader.apply(options.tree);

  let events: EventSource | undefined;
  if (options.hmr !== false) {
    events = new EventSource(options.hmr ?? "/@hmr");
    events.onmessage = async (e) => {
      const { accepted, versions: next, restart } = JSON.parse(e.data) as {
        accepted: string[];
        versions: Record<string, number>;
        restart: string[];
      };
      for (const [path, v] of Object.entries(next)) versions.set(path, v);
      const urls = accepted.map((p) => new URL(p, location.origin).href);
      try {
        const reloaded = await loader.reload(urls);
        host.onReload?.(reloaded, restart);
      } catch (error) {
        runtime.onError(runtime.rootFiber, error);
      }
    };
  }
  return host;
}
