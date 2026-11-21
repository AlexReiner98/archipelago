/**
 * The bridge, browser side: provides the keys a bridge server serves
 * (server.ts) by calling it, so packs in the page inject `agent.tree` or
 * `verdict.read` as if they ran there. Each consumer's watches are its own
 * effects and go when it unloads. If the stream drops and comes back (the
 * server restarted), every watch is made again and the copies refreshed.
 *
 * A stream the browser gives up on is opened again: an EventSource retries
 * by itself only after a network error, and closes for good on an answer
 * that isn't the stream, such as a proxy's 502 while the server restarts
 * behind it. The page would then stay on its old copy of the map.
 */
import type { Dispose } from "../../spec/common.ts";
import type { Context, Pack } from "../../runtime/core.ts";

export interface BridgeClientConfig {
  /** The bridge server, ending in `/`. Default http://127.0.0.1:5182/. */
  url?: string;
  /** Milliseconds before a closed stream is opened again, doubling to 30 s. Default 1000. */
  retry?: number;
}

interface Watch {
  key: string;
  method: string;
  args: unknown[];
  on: (...args: any[]) => void;
}

const client: Pack<BridgeClientConfig> = {
  id: "bridge",
  async apply(ctx: Context, config: BridgeClientConfig = {}) {
    const url = config.url ?? "http://127.0.0.1:5182/";
    const post = async (path: string, msg: unknown) => {
      const res = await fetch(url + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(msg) });
      return res.json();
    };
    const call = async (key: string, method: string, args: unknown[]) => {
      const out = await post("call", { key, method, args });
      if ("error" in out) throw Object.assign(new Error(out.error), out.refusal ? { refusal: out.refusal } : {});
      return out.value;
    };

    const caps = (await (await fetch(url + "caps")).json()) as { keys: string[]; sync: Record<string, string> };
    const watches = new Map<number, Watch>();
    let n = 0;
    let stream: string | undefined;
    const copies = new Map<string, unknown>();
    const local = new Map<string, Set<() => void>>();

    const subscribe = (id: number, w: Watch) => stream && post("watch", { stream, id, key: w.key, method: w.method, args: w.args });
    const refresh = async (key: string) => {
      copies.set(key, await call(key, caps.sync[key]!, []));
      for (const on of [...(local.get(key) ?? [])]) on();
    };

    let opened!: () => void;
    const ready = new Promise<void>((ok) => (opened = ok));
    let events: EventSource | undefined;
    let wait = config.retry ?? 1000;
    const onmessage = (e: MessageEvent) => {
      wait = config.retry ?? 1000;
      const m = JSON.parse(e.data);
      if (m.stream) {
        const again = stream !== undefined;
        stream = m.stream;
        for (const [id, w] of watches) void subscribe(id, w);
        if (again) for (const key of Object.keys(caps.sync)) void refresh(key);
        opened();
        return;
      }
      const w = watches.get(m.watch);
      if (!w) return;
      try {
        w.on(...(m.args ?? []));
      } catch (err) {
        ctx.runtime.report(ctx.fiber, err);
      }
    };
    // The stream, and opening it again when the browser has given up on it.
    let reopen: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const open = () => {
      reopen = undefined;
      if (done) return;
      const es = new EventSource(url + "events");
      events = es;
      es.onmessage = onmessage;
      es.onerror = () => {
        if (es.readyState !== EventSource.CLOSED || done || reopen) return;
        reopen = setTimeout(open, wait);
        wait = Math.min(wait * 2, 30000);
      };
    };
    ctx.effect(() => () => {
      done = true;
      clearTimeout(reopen);
      events?.close();
    });
    open();
    await ready;

    // The synchronous reads: a copy, kept fresh by the key's own watch.
    for (const key of Object.keys(caps.sync)) {
      local.set(key, new Set());
      const id = ++n;
      watches.set(id, { key, method: "watch", args: [], on: () => void refresh(key) });
      void subscribe(id, watches.get(id)!);
      await refresh(key);
    }

    for (const key of caps.keys) {
      ctx.provide(key, (_caller, from) => {
        const sync = caps.sync[key];
        return new Proxy(
          {},
          {
            get(_t, name) {
              if (typeof name !== "string" || name === "then") return undefined;
              if (name === sync) return () => copies.get(key);
              if (name === "watch") {
                return (...args: unknown[]): Dispose => {
                  const on = args.pop() as Watch["on"];
                  if (sync) {
                    return from.effect(() => {
                      local.get(key)!.add(on);
                      return () => local.get(key)!.delete(on);
                    });
                  }
                  return from.effect(() => {
                    const id = ++n;
                    const w = { key, method: name, args, on };
                    watches.set(id, w);
                    void subscribe(id, w);
                    return () => {
                      watches.delete(id);
                      if (stream) void post("unwatch", { stream, id }).catch(() => {});
                    };
                  });
                };
              }
              return (...args: unknown[]) => call(key, name, args);
            },
          },
        );
      });
    }
  },
};

export default client;
