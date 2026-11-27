/**
 * The exchange plugin: one event per say, refusal and act, kept and streamed.
 * Provides exchange.append, exchange.read and exchange.watch (spec/exchange.md).
 *
 * Without a journal (a test, a page), events are kept in memory (`Log`).
 * When `config.journal` names a file, events are appended to it as JSON
 * lines and read back on load, so the record outlives a restart, and memory
 * keeps no event at all (`FileLog`): only where each one's line is, which
 * runs and nodes it belongs to, and each run's summary (its begins merged,
 * its end, its last time). A page of events is read back from the file, a
 * line at a time. Loading streams the file the same way. So the heap holds
 * an index of the record, never the record: a hosted map's journal of
 * 180,000 events (300 MB) is a few MB of it.
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
import type { Context, Plugin } from "../../runtime/core.ts";
import { eventNow } from "../graph/renamed.ts";

export interface ExchangeConfig {
  /** A file to keep events in, one JSON object per line. Node only. */
  journal?: string;
}

type Watcher = { filter: ExchangeFilter; on: (event: ExchangeEvent) => void };
type NewEvent = Omit<ExchangeEvent, "id" | "seq"> & Partial<Pick<ExchangeEvent, "id" | "seq">>;

function limitOf(page?: PageRequest): number {
  return Math.max(1, Math.min(page?.limit ?? 100, LIMIT_MAX));
}

function matches(f: ExchangeFilter, e: ExchangeEvent): boolean {
  if (f.run !== undefined && f.run !== e.run) return false;
  if (f.node !== undefined && f.node !== e.node) return false;
  if (f.plugin !== undefined && f.plugin !== e.plugin) return false;
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

/** What the plugin needs of a record, in memory or in a file. */
interface Record {
  readonly order: Set<RunId>;
  info(run: RunId): RunInfo | undefined;
  /** Records an event; `done` once it is kept (written, with a journal). */
  append(e: NewEvent): { event: ExchangeEvent; done: Promise<void> };
  events(run: RunId, page?: PageRequest): Promise<Page<ExchangeEvent>>;
  said(node: string, page?: PageRequest): Promise<Page<ExchangeEvent>>;
}

/** A run's summary as its events arrive: begins merged, the first's start, an end after the last begin, the last time. */
class RunSummary {
  private merged: RunInfo | undefined;
  private started: string | undefined;
  private ended: string | undefined;
  private last: string | undefined;
  see(e: ExchangeEvent): void {
    if (e.kind === "begin" && e.detail) {
      const d = e.detail as unknown as RunInfo;
      if (!this.merged) this.started = d.started;
      this.merged = Object.assign({}, this.merged, d);
      this.ended = undefined;
    } else if (e.kind === "end" && this.merged) this.ended = e.time;
    this.last = e.time;
  }
  info(): RunInfo | undefined {
    if (!this.merged) return undefined;
    return { ...this.merged, started: this.started!, ...(this.ended ? { ended: this.ended } : {}), ...(this.last ? { last: this.last } : {}) };
  }
}

/** The record in memory, for a map with no journal. */
export class Log implements Record {
  /** Events per run, in seq order. */
  readonly runs = new Map<RunId, ExchangeEvent[]>();
  /** Runs by their last event: the one that acted last is last. */
  readonly order = new Set<RunId>();
  /** Events per node, oldest first. */
  readonly byNode = new Map<string, ExchangeEvent[]>();
  private readonly summaries = new Map<RunId, RunSummary>();

  add(e: NewEvent): ExchangeEvent {
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
    const s = this.summaries.get(e.run) ?? new RunSummary();
    s.see(event);
    this.summaries.set(e.run, s);
    return event;
  }

  /**
   * A run as its `begin` events recorded it: a later one says more (a
   * title, its task) and keeps when the first began. With its end if one
   * came after its last begin: a run that begins again (a server restart)
   * is open again.
   */
  info(run: RunId): RunInfo | undefined {
    return this.summaries.get(run)?.info();
  }

  append(e: NewEvent) {
    return { event: this.add(e), done: Promise.resolve() };
  }

  async events(run: RunId, page?: PageRequest) {
    return pageOf(this.runs.get(run) ?? [], page);
  }

  async said(node: string, page?: PageRequest) {
    return pageOf([...(this.byNode.get(node) ?? [])].reverse(), page);
  }
}

/**
 * The record in a journal file. Memory holds, per event, where its line is
 * (its first byte and its length) and its seq; per run and per node, its
 * events' numbers in order; and each run's summary. Events are read back
 * from the file a page at a time.
 */
export class FileLog implements Record {
  readonly file: string;
  readonly order = new Set<RunId>();
  /** Event numbers per run, in seq order, and per node, oldest first. */
  readonly runs = new Map<RunId, number[]>();
  readonly byNode = new Map<string, number[]>();
  private readonly summaries = new Map<RunId, RunSummary>();
  /** Per event, by its number: where its line starts, how long it is (newline left out), its seq. */
  private readonly at: number[] = [];
  private readonly len: number[] = [];
  private readonly seqs: number[] = [];
  /** Where the next line goes, counted as each is queued, so a line's place is known before it is written. */
  private size = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  /** Indexes an event at its line's place. */
  private index(e: ExchangeEvent, at: number, len: number): void {
    const n = this.at.length;
    this.at.push(at);
    this.len.push(len);
    this.seqs.push(e.seq);
    const list = this.runs.get(e.run) ?? [];
    list.push(n);
    this.runs.set(e.run, list);
    if (e.node) {
      const byNode = this.byNode.get(e.node) ?? [];
      byNode.push(n);
      this.byNode.set(e.node, byNode);
    }
    this.order.delete(e.run);
    this.order.add(e.run);
    const s = this.summaries.get(e.run) ?? new RunSummary();
    s.see(e);
    this.summaries.set(e.run, s);
  }

  /** An event as the record gives it: a seq and an id even on a line from before they were written. */
  private complete(e: ExchangeEvent, seq: number): ExchangeEvent {
    const s = e.seq ?? seq;
    return { ...e, seq: s, id: e.id ?? `${e.run}:${s}` };
  }

  /** Streams the file in, a line at a time. A missing file is an empty record. */
  async load(): Promise<void> {
    const { createReadStream } = await import("node:fs");
    const { stat } = await import("node:fs/promises");
    try {
      await stat(this.file);
    } catch {
      return;
    }
    let at = 0;
    let rest = Buffer.alloc(0);
    const take = (line: Buffer, start: number) => {
      const text = line.toString("utf8");
      if (!text.trim()) return;
      const raw = eventNow(JSON.parse(text) as ExchangeEvent);
      this.index(this.complete(raw, (this.runs.get(raw.run)?.length ?? 0) + 1), start, line.length);
    };
    for await (const chunk of createReadStream(this.file) as AsyncIterable<Buffer>) {
      const buf = rest.length ? Buffer.concat([rest, chunk]) : chunk;
      let from = 0;
      for (let nl = buf.indexOf(10, from); nl !== -1; nl = buf.indexOf(10, from)) {
        take(buf.subarray(from, nl), at + from);
        from = nl + 1;
      }
      at += from;
      rest = Buffer.from(buf.subarray(from));
    }
    if (rest.length) take(rest, at);
    this.size = at + rest.length;
  }

  info(run: RunId): RunInfo | undefined {
    return this.summaries.get(run)?.info();
  }

  /** Appends an event: indexed at once, its bytes written once the queue reaches it. */
  append(e: NewEvent) {
    const seq = e.seq ?? (this.runs.get(e.run)?.length ?? 0) + 1;
    const event: ExchangeEvent = { ...e, seq, id: e.id ?? `${e.run}:${seq}` };
    const line = Buffer.from(JSON.stringify(event) + "\n", "utf8");
    this.index(event, this.size, line.length - 1);
    this.size += line.length;
    const done = this.queue.then(async () => {
      const { appendFile } = await import("node:fs/promises");
      await appendFile(this.file, line);
    });
    this.queue = done.catch(() => {});
    return { event, done };
  }

  /** Events by their numbers, read back from the file, one open for them all. */
  private async read(numbers: number[]): Promise<ExchangeEvent[]> {
    if (!numbers.length) return [];
    await this.queue;
    const { open } = await import("node:fs/promises");
    const fh = await open(this.file, "r");
    try {
      const out: ExchangeEvent[] = [];
      for (const n of numbers) {
        const buf = Buffer.alloc(this.len[n]!);
        await fh.read(buf, 0, buf.length, this.at[n]!);
        out.push(this.complete(eventNow(JSON.parse(buf.toString("utf8")) as ExchangeEvent), this.seqs[n]!));
      }
      return out;
    } finally {
      await fh.close();
    }
  }

  async events(run: RunId, page?: PageRequest) {
    const p = pageOf(this.runs.get(run) ?? [], page);
    return { ...p, items: await this.read(p.items) };
  }

  async said(node: string, page?: PageRequest) {
    const p = pageOf([...(this.byNode.get(node) ?? [])].reverse(), page);
    return { ...p, items: await this.read(p.items) };
  }

  /** How many events it indexes. */
  get count(): number {
    return this.at.length;
  }
}

const exchange: Plugin<ExchangeConfig> = {
  id: "exchange",
  about: "Records everything said to agents and everything they do, in order.",
  async apply(ctx: Context, config: ExchangeConfig = {}) {
    let record: Record;
    if (config.journal) {
      const file = new FileLog(config.journal);
      await file.load();
      record = file;
    } else record = new Log();
    const watchers = new Set<Watcher>();

    ctx.provide<ExchangeAppend>("exchange.append", () => ({
      async append(e) {
        const { event, done } = record.append(e);
        for (const w of [...watchers]) {
          if (!matches(w.filter, event)) continue;
          try {
            w.on(event);
          } catch (err) {
            ctx.runtime.report(ctx.fiber, err);
          }
        }
        await done;
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
        return record.events(run, page);
      },
      async said(node, page) {
        return record.said(node, page);
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
