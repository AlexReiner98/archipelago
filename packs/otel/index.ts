/**
 * The otel pack: the exchange as OpenTelemetry spans, posted as OTLP/HTTP
 * JSON with `fetch` to the collector `config.endpoint` names. Off (it only
 * answers `otel.status`, with `on: false`) unless it names one. The rules
 * that turn events into spans are in spans.ts.
 *
 * - Watches every event as it is appended (`exchange.watch`); nothing from
 *   before it loaded is sent.
 * - An act is a span as soon as it is recorded, sent in a batch (at most
 *   every `batch_ms`, or at BATCH spans). A run's own span goes when it
 *   ends, with its token use read from the transcript (`transcript.tokens`)
 *   when the transcript pack answers.
 * - A run that began before this pack loaded is read from its first event
 *   (`exchange.read`, one event) when it ends.
 * - A batch that fails is tried again once, then dropped; the run's status
 *   says so.
 * - `config.include_content` (default false) is the only way the map's or
 *   the agent's words leave the machine.
 * - One read-only action, `otel.status` ({ runs }): whether each run was
 *   exported, how many spans, when, and where (the endpoint without its
 *   query or credentials). The otel view (view.ts) shows it on the run.
 *
 * Injects exchange.watch, exchange.read, action.register and action.invoke.
 */
import type { ActionInvoke, ActionRegister } from "../../spec/action.ts";
import type { RunInfo } from "../../spec/agent.ts";
import type { Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { ExchangeEvent, ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { actSpan, EVENTS_MAX, request, runEvent, runSpan, shownUrl, tracesUrl, type RunState, type Span, type Tokens } from "./spans.ts";

export interface OtelConfig {
  /** The collector: an OTLP/HTTP base (`http://127.0.0.1:4318`) or its `/v1/traces`. Absent: off. */
  endpoint?: string;
  /** Sent with each export (an API key a backend wants). Never shown. */
  headers?: Record<string, string>;
  /** Send the words: what was said, tool input and output, titles, folders, places in full. Default false. */
  include_content?: boolean;
  /** `service.name`. Default `archipelago`. */
  service?: string;
  /** The longest a span waits before its batch is sent. Default BATCH_MS. */
  batch_ms?: number;
  /** For tests: another fetch. */
  fetch?: typeof fetch;
}

export const STATUS = "otel.status";
export const TOKENS = "transcript.tokens";
export const BATCH_MS = 2000;
/** A batch is sent at once when it holds this many spans. */
export const BATCH = 200;
/** The most runs kept open at once; the oldest goes beyond it, unsent. */
export const OPEN_MAX = 500;
/** The most runs whose status is kept. */
export const KEPT_MAX = 1000;
/** The most pages of token rows read for one run. */
export const TOKEN_PAGES = 50;

/** What `otel.status` says of a run. */
export interface RunStatus {
  run: string;
  /** Spans the collector took. */
  spans: number;
  /** Spans dropped after a failed send. */
  failed: number;
  /** When it last took some. */
  sent?: string;
  /** The run's own span went: it ended and was sent whole. */
  whole: boolean;
  /** The last send's error, while it stands. */
  error?: string;
}

const refuse = (code: string, message: string) => new Refused({ code, message, by: { pack: "otel" } });

const otel: Pack<OtelConfig> = {
  id: "otel",
  about: "Posts each run on the exchange as an OpenTelemetry span, each act as a child, to an OTLP/HTTP collector.",
  inject: ["exchange.watch", "exchange.read", "action.register", "action.invoke"],
  apply(ctx: Context, config: OtelConfig = {}) {
    const on = typeof config.endpoint === "string" && config.endpoint.length > 0;
    const url = on ? tracesUrl(config.endpoint!) : undefined;
    const where = on ? shownUrl(config.endpoint!) : undefined;
    const content = config.include_content === true;
    const service = config.service ?? "archipelago";
    const wait = Math.max(0, config.batch_ms ?? BATCH_MS);
    const send = config.fetch ?? globalThis.fetch;

    const status = new Map<string, RunStatus>();
    const statusOf = (run: string): RunStatus => {
      let s = status.get(run);
      if (!s) {
        s = { run, spans: 0, failed: 0, whole: false };
        status.set(run, s);
        if (status.size > KEPT_MAX) status.delete(status.keys().next().value!);
      }
      return s;
    };

    ctx.get<ActionRegister>("action.register").register({
      name: STATUS,
      title: "Whether runs were exported as OpenTelemetry spans, and where",
      doc: "Per run: spans the collector took, spans dropped, when it last took some, whether the run's own span went, the last error. With where the spans go (no credentials) and whether words are sent. Writes nothing.",
      input: { type: "object", properties: { runs: { type: "array", items: { type: "string" }, description: "Run ids, at most LIMIT_MAX" } }, required: ["runs"] },
      async run(input: { runs?: string[] }) {
        if (!Array.isArray(input.runs) || input.runs.length > LIMIT_MAX) throw refuse("otel.runs", `runs is a list of at most ${LIMIT_MAX} run ids.`);
        return {
          on,
          ...(where ? { endpoint: where } : {}),
          include_content: content,
          runs: input.runs.map((r) => status.get(r) ?? { run: r, spans: 0, failed: 0, whole: false }) as unknown as Json,
        };
      },
    });
    if (!on) return;

    const read = ctx.get<ExchangeRead>("exchange.read");
    const invoke = ctx.get<ActionInvoke>("action.invoke");
    const open = new Map<string, RunState & { reached: Map<string, string> }>();
    let queue: { span: Span; tries: number }[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let sending: Promise<void> = Promise.resolve();
    let stopped = false;

    const flush = (): Promise<void> => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      const batch = queue;
      queue = [];
      if (!batch.length) return sending;
      sending = sending.then(async () => {
        let error: string | undefined;
        try {
          const res = await send(url!, {
            method: "POST",
            headers: { "content-type": "application/json", ...(config.headers ?? {}) },
            body: JSON.stringify(request(batch.map((b) => b.span), service)),
          });
          if (!res.ok) error = `${res.status} ${res.statusText}`.trim();
          await res.text().catch(() => "");
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        const at = new Date().toISOString();
        for (const b of batch) {
          const run = b.span.attributes.find((a) => a.key === "gen_ai.conversation.id")?.value;
          const s = statusOf(run && "stringValue" in run ? run.stringValue : b.span.traceId);
          const whole = !b.span.parentSpanId;
          if (!error) {
            s.spans++;
            s.sent = at;
            delete s.error;
            if (whole) s.whole = true;
          } else {
            s.error = error;
            if (b.tries < 1 && !stopped) queue.push({ span: b.span, tries: b.tries + 1 });
            else s.failed++;
          }
        }
        if (error && queue.length && !stopped) later();
      });
      return sending;
    };
    const later = () => {
      if (stopped) return;
      if (queue.length >= BATCH) void flush();
      else if (!timer) timer = setTimeout(() => void flush(), wait);
    };
    const enqueue = (span: Span) => {
      queue.push({ span, tries: 0 });
      later();
    };

    const stateOf = (e: ExchangeEvent) => {
      let s = open.get(e.run);
      if (!s) {
        s = { run: e.run, start: e.time, last: e.time, events: [], dropped: 0, count: {}, reached: new Map() };
        open.set(e.run, s);
        if (open.size > OPEN_MAX) open.delete(open.keys().next().value!);
      }
      return s;
    };

    /** The run's token use from the transcript, or nothing when it has none or no pack answers. */
    const tokensOf = async (run: string): Promise<Tokens | undefined> => {
      const t: Tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      let rows = 0;
      let after: number | undefined;
      for (let p = 0; p < TOKEN_PAGES; p++) {
        const out = await invoke.invoke({ action: TOKENS, input: { run, kind: "usage", limit: LIMIT_MAX, ...(after !== undefined ? { after } : {}) }, authority: { of: "agent", basis: "otel: a run's token use for its span" }, reason: "otel export" });
        if (!out.ok) return undefined;
        const o = out.output as { rows?: { n: number; input?: number; output?: number; cacheRead?: number; cacheWrite?: number; model?: string }[]; next?: number | string; none?: boolean };
        if (o.none) return undefined;
        for (const r of o.rows ?? []) {
          rows++;
          t.input += r.input ?? 0;
          t.output += r.output ?? 0;
          t.cacheRead += r.cacheRead ?? 0;
          t.cacheWrite += r.cacheWrite ?? 0;
          if (r.model) t.model = r.model;
          after = r.n;
        }
        if (o.next === undefined || o.next === null) break;
        after = Number(o.next);
      }
      return rows ? t : undefined;
    };

    const ended = async (s: RunState, time: string) => {
      if (!s.info) {
        const first = await read.events(s.run, { limit: 1 }).catch(() => undefined);
        const b = first?.items[0];
        if (b?.kind === "begin" && b.detail) s.info = b.detail as unknown as RunInfo;
      }
      const tokens = await tokensOf(s.run).catch(() => undefined);
      enqueue(runSpan(s, time, content, tokens));
      void flush();
    };

    const take = (e: ExchangeEvent) => {
      if (stopped) return;
      const s = stateOf(e);
      s.last = e.time;
      s.count[e.kind] = (s.count[e.kind] ?? 0) + 1;
      if (e.kind === "begin") {
        s.info = e.detail as unknown as RunInfo;
        s.start = s.info?.started ?? e.time;
      } else if (e.kind === "end") {
        open.delete(e.run);
        void ended(s, e.time);
      } else if (e.kind === "act" && e.act) {
        enqueue(actSpan(e, content, e.place ? s.reached.get(e.place) : undefined));
        if (e.place) s.reached.delete(e.place);
      } else if (e.direction === "to_agent" || e.kind === "miss") {
        if (e.place && !s.reached.has(e.place)) s.reached.set(e.place, e.time);
        if (s.events.length < EVENTS_MAX) s.events.push(runEvent(e, content));
        else s.dropped++;
      }
    };

    ctx.effect(() => ctx.get<ExchangeWatch>("exchange.watch").watch({}, take));
    ctx.effect(() => () => {
      // What is queued goes on its way; nothing after.
      void flush();
      stopped = true;
      open.clear();
    });
  },
};

export default otel;
