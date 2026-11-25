/**
 * The exchange plugin: one event per say, refusal and act, kept and streamed.
 * Provides exchange.append, exchange.read and exchange.watch (spec/exchange.md).
 *
 * Events are kept in memory and, when `config.journal` names a file, appended
 * to it as JSON lines and read back on load, so the record outlives a restart.
 * With a journal, an act's body (its input and output, nearly all of the
 * record's bytes) stays in the file: memory keeps where its line is, and a
 * page of events reads the bodies it holds back from there. Loading streams
 * the file a line at a time, so the heap holds neither the whole text nor
 * every act.
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

/** The record itself, apart from the runtime, so it can be read back from a journal. */
export class Log {
  /** Events per run, in seq order. */
  readonly runs = new Map<RunId, ExchangeEvent[]>();
  /** Runs by their last event: the one that acted last is last. */
  readonly order = new Set<RunId>();
  /** Events per node, oldest first. */
  readonly byNode = new Map<string, ExchangeEvent[]>();

  /** `keep` gives what is held for an event (the journal drops an act's body); `add` still answers the whole event. */
  private readonly keep: (e: ExchangeEvent) => ExchangeEvent;

  constructor(keep: (e: ExchangeEvent) => ExchangeEvent = (e) => e) {
    this.keep = keep;
  }

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
    const held = this.keep(event);
    list.push(held);
    if (event.node) {
      const n = this.byNode.get(event.node) ?? [];
      n.push(held);
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
    const begun = list.lastIndexOf(begins[begins.length - 1]!);
    const end = list.slice(begun + 1).find((e) => e.kind === "end");
    const last = list[list.length - 1]?.time;
    return { ...merged, started: first.started, ...(end ? { ended: end.time } : {}), ...(last ? { last } : {}) };
  }
}

/** Where an event's line is in the journal: its first byte and its length, newline left out. */
type Span = { at: number; len: number };

/**
 * The journal file: appended to, read back a line at a time on load, and
 * read at a line's place for an act's body. `size` is where the next line
 * goes, counted as each is queued, so a span is known before it is written.
 */
export class Journal {
  private size = 0;
  private queue: Promise<unknown> = Promise.resolve();
  /** Each act's line, by event id: its body is read from there. */
  private readonly spans = new Map<string, Span>();

  readonly file: string;

  constructor(file: string) {
    this.file = file;
  }

  /**
   * What memory holds of an event: an act without its body. Its span is set
   * on load before `add`, and on append right after it with nothing awaited
   * between, so no read finds an act with neither.
   */
  readonly keep = (e: ExchangeEvent): ExchangeEvent => {
    if (!e.act) return e;
    const { act: _body, ...rest } = e;
    return rest;
  };

  /** Streams the file into `into`, a line at a time. A missing file is an empty record. */
  async load(into: Log): Promise<void> {
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
      const e = eventNow(JSON.parse(text) as ExchangeEvent);
      if (e.act && e.id) this.spans.set(e.id, { at: start, len: line.length });
      into.add(e);
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

  /** Appends an event; its span is known at once, its bytes once the queue reaches it. */
  append(e: ExchangeEvent): Promise<void> {
    const line = Buffer.from(JSON.stringify(e) + "\n", "utf8");
    const span = { at: this.size, len: line.length - 1 };
    this.size += line.length;
    if (e.act) this.spans.set(e.id, span);
    const done = this.queue.then(async () => {
      const { appendFile } = await import("node:fs/promises");
      await appendFile(this.file, line);
    });
    this.queue = done.catch(() => {});
    return done;
  }

  /** The events with their acts' bodies read back from the file, one open for the page. */
  async whole(events: ExchangeEvent[]): Promise<ExchangeEvent[]> {
    const need = events.filter((e) => e.kind === "act" && !e.act && this.spans.has(e.id));
    if (!need.length) return events;
    await this.queue;
    const { open } = await import("node:fs/promises");
    const fh = await open(this.file, "r");
    const bodies = new Map<string, ExchangeEvent["act"]>();
    try {
      for (const e of need) {
        const { at, len } = this.spans.get(e.id)!;
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, at);
        bodies.set(e.id, (JSON.parse(buf.toString("utf8")) as ExchangeEvent).act);
      }
    } finally {
      await fh.close();
    }
    return events.map((e) => (bodies.has(e.id) ? { ...e, act: bodies.get(e.id) } : e));
  }
}

const exchange: Plugin<ExchangeConfig> = {
  id: "exchange",
  about: "Records everything said to agents and everything they do, in order.",
  async apply(ctx: Context, config: ExchangeConfig = {}) {
    const journal = config.journal ? new Journal(config.journal) : undefined;
    const record = new Log(journal?.keep);
    await journal?.load(record);
    const write = journal ? (e: ExchangeEvent) => journal.append(e) : undefined;
    const whole = async (p: Page<ExchangeEvent>): Promise<Page<ExchangeEvent>> => (journal ? { ...p, items: await journal.whole(p.items) } : p);
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
        return whole(pageOf(record.runs.get(run) ?? [], page));
      },
      async said(node, page) {
        return whole(pageOf([...(record.byNode.get(node) ?? [])].reverse(), page));
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
