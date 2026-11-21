/**
 * The exchange pack: one event per say, refusal and act, kept and streamed.
 * Provides exchange.append, exchange.read and exchange.watch (spec/exchange.md).
 *
 * Events are kept in memory and, when `config.journal` names a file, appended
 * to it as JSON lines and read back on load, so the record outlives a restart.
 */
import type { RunId, RunInfo } from "../../spec/agent.ts";
import type { Dispose, Page, PageRequest } from "../../spec/common.ts";
import type {
  ExchangeAppend,
  ExchangeEvent,
  ExchangeFilter,
  ExchangeRead,
  ExchangeWatch,
} from "../../spec/exchange.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";

export interface ExchangeConfig {
  /** A file to keep events in, one JSON object per line. Node only. */
  journal?: string;
}

type Watcher = { filter: ExchangeFilter; on: (event: ExchangeEvent) => void };

function limitOf(page?: PageRequest): number {
  return Math.max(1, Math.min(page?.limit ?? 100, LIMIT_MAX));
}

function matches(f: ExchangeFilter, e: ExchangeEvent): boolean {
  if (f.run !== undefined && f.run !== e.run) return false;
  if (f.node !== undefined && f.node !== e.node) return false;
  if (f.pack !== undefined && f.pack !== e.pack) return false;
  if (f.kinds && !f.kinds.includes(e.kind)) return false;
  return true;
}

/** Pages a list by index; the cursor is the index to start at. */
function pageOf<T>(list: T[], page?: PageRequest): Page<T> {
  const start = page?.after ? Number(page.after) : 0;
  const end = start + limitOf(page);
  const items = list.slice(start, end);
  return end < list.length ? { items, next: String(end) } : { items };
}

/** The record itself, apart from the runtime, so it can be read back from a journal. */
export class Log {
  /** Events per run, in seq order. */
  readonly runs = new Map<RunId, ExchangeEvent[]>();
  /** Runs by their last event: the one that acted last is last. */
  readonly order = new Set<RunId>();
  /** Events per node, oldest first. */
  readonly byNode = new Map<string, ExchangeEvent[]>();

  add(e: Omit<ExchangeEvent, "id" | "seq"> & Partial<Pick<ExchangeEvent, "id" | "seq">>): ExchangeEvent {
    let list = this.runs.get(e.run);
    if (!list) {
      list = [];
      this.runs.set(e.run, list);
    }
    this.order.delete(e.run);
    this.order.add(e.run);
    const seq = e.seq ?? list.length + 1;
    const event: ExchangeEvent = { ...e, seq, id: e.id ?? `${e.run}:${seq}` };
    list.push(event);
    if (event.node) {
      const n = this.byNode.get(event.node) ?? [];
      n.push(event);
      this.byNode.set(event.node, n);
    }
    return event;
  }

  /**
   * A run as its `begin` events recorded it: a later one says more (a
   * title, its task) and keeps when the first began. With its end if one
   * came after its last begin: a run that begins again (a server restart)
   * is open again.
   */
  info(run: RunId): RunInfo | undefined {
    const list = this.runs.get(run) ?? [];
    const begins = list.filter((e) => e.kind === "begin" && e.detail);
    if (!begins.length) return undefined;
    const first = begins[0]!.detail as unknown as RunInfo;
    const merged = Object.assign({}, ...begins.map((b) => b.detail)) as RunInfo;
    const last = list.lastIndexOf(begins[begins.length - 1]!);
    const end = list.slice(last + 1).find((e) => e.kind === "end");
    return { ...merged, started: first.started, ...(end ? { ended: end.time } : {}) };
  }
}

async function readJournal(file: string, into: Log): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) if (line.trim()) into.add(JSON.parse(line) as ExchangeEvent);
}

async function journalWriter(file: string): Promise<(e: ExchangeEvent) => Promise<void>> {
  const { appendFile } = await import("node:fs/promises");
  let queue = Promise.resolve();
  return (e) => (queue = queue.then(() => appendFile(file, JSON.stringify(e) + "\n")));
}

const exchange: Pack<ExchangeConfig> = {
  id: "exchange",
  about: "Records everything said to agents and everything they do, in order.",
  async apply(ctx: Context, config: ExchangeConfig = {}) {
    const record = new Log();
    if (config.journal) await readJournal(config.journal, record);
    const write = config.journal ? await journalWriter(config.journal) : undefined;
    const watchers = new Set<Watcher>();

    ctx.provide<ExchangeAppend>("exchange.append", () => ({
      async append(e) {
        const event = record.add(e);
        for (const w of [...watchers]) {
          if (!matches(w.filter, event)) continue;
          try {
            w.on(event);
          } catch (err) {
            ctx.runtime.report(ctx.fiber, err);
          }
        }
        await write?.(event);
        return event;
      },
    }));

    ctx.provide<ExchangeRead>("exchange.read", () => ({
      async runs(page) {
        const infos = [...record.order]
          .reverse()
          .map((r) => record.info(r))
          .filter((r): r is RunInfo => !!r);
        return pageOf(infos, page);
      },
      async events(run, page) {
        return pageOf(record.runs.get(run) ?? [], page);
      },
      async said(node, page) {
        return pageOf([...(record.byNode.get(node) ?? [])].reverse(), page);
      },
    }));

    ctx.provide<ExchangeWatch>("exchange.watch", (_caller, from) => ({
      watch(filter, on): Dispose {
        return from.effect(() => {
          const w = { filter, on };
          watchers.add(w);
          return () => watchers.delete(w);
        });
      },
    }));
  },
};

export default exchange;
