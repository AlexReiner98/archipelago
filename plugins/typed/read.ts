/**
 * A typed call read back from the exchange: its run's begin says what it
 * is (`typed`, `model`), its acts say how it went. Nothing is kept apart
 * from the exchange, so what `typed.get` shows is what was recorded.
 */
import type { RunInfo } from "../../spec/agent.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Json } from "../../spec/common.ts";
import type { ExchangeEvent, ExchangeRead } from "../../spec/exchange.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";

/** The run fact naming a typed call's type. */
export const TYPED = "typed";
/** Where each attempt (the model's reply) and each check are recorded. */
export const ATTEMPT_AT = "typed:attempt";
export const CHECK_AT = "typed:check";

export interface AttemptRecord {
  attempt: number;
  /** The reply, parsed; or its words, when they held no JSON. */
  json?: Json;
  text?: string;
  error?: string;
  usage?: { input: number; output: number; model?: string };
  /** What was sent back before this attempt. */
  sent?: string;
  /** The check of this attempt's facts. */
  fits?: boolean;
  facts?: Fact[];
  problems?: { code: string; message: string; at?: string; field?: string }[];
  /** The retry this attempt's misfit sends back, or why none. */
  retry?: string;
  failed?: string;
}

export interface TypedRecord {
  run: string;
  title?: string;
  type: string;
  model?: string;
  parent?: string;
  started: string;
  ended?: string;
  /** The JSON Schema the model was held to. */
  schema?: Json;
  attempts: AttemptRecord[];
  /** `fit`, `misfit` (retries spent), `failed` (the model or the check threw), `open` (not answered yet). */
  outcome: "fit" | "misfit" | "failed" | "open";
  /** The facts a fitting call proposes. */
  proposed?: Fact[];
  usage: { input: number; output: number };
  /** A person's decision on it, if one is recorded (call.decide). */
  decision?: "accepted" | "rejected";
}

const obj = (v: unknown): Record<string, Json> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : {});

/** A typed call's record from its events. Undefined when the run isn't a typed call. */
export function typedOf(info: RunInfo, events: ExchangeEvent[]): TypedRecord | undefined {
  const type = info.facts?.[TYPED];
  if (typeof type !== "string") return undefined;
  const rec: TypedRecord = {
    run: info.run,
    type,
    started: info.started,
    attempts: [],
    outcome: "open",
    usage: { input: 0, output: 0 },
    ...(info.title ? { title: info.title } : {}),
    ...(typeof info.facts?.model === "string" ? { model: info.facts.model } : {}),
    ...(typeof info.facts?.parent === "string" ? { parent: info.facts.parent } : {}),
    ...(info.ended ? { ended: info.ended } : {}),
  };
  for (const e of events) {
    if (e.kind !== "act" || !e.act) continue;
    const input = obj(e.act.input);
    const output = obj(e.act.output);
    if (e.place === ATTEMPT_AT) {
      if (input.schema !== undefined && rec.schema === undefined) rec.schema = input.schema;
      const usage = output.usage as AttemptRecord["usage"] | undefined;
      if (usage) {
        rec.usage.input += usage.input ?? 0;
        rec.usage.output += usage.output ?? 0;
      }
      rec.attempts.push({
        attempt: Number(input.attempt ?? rec.attempts.length + 1),
        ...(output.json !== undefined ? { json: output.json } : {}),
        ...(typeof output.text === "string" ? { text: output.text } : {}),
        ...(typeof output.error === "string" ? { error: output.error } : {}),
        ...(usage ? { usage } : {}),
        ...(typeof input.retry === "string" ? { sent: input.retry } : {}),
      });
      if (typeof output.error === "string") rec.outcome = "failed";
    } else if (e.place === CHECK_AT) {
      const a = rec.attempts[rec.attempts.length - 1];
      if (!a) continue;
      a.fits = output.fits === true;
      a.facts = (input.facts as unknown as Fact[]) ?? [];
      a.problems = (output.problems as unknown as AttemptRecord["problems"]) ?? [];
      if (typeof output.retry === "string") a.retry = output.retry;
      if (typeof output.failed === "string") a.failed = output.failed;
      if (a.fits) {
        rec.outcome = "fit";
        rec.proposed = a.facts;
      } else if (!a.retry) rec.outcome = "misfit";
    } else if (e.act.kind === "reply" && e.act.ok === false && rec.outcome === "open") rec.outcome = "failed";
    else if (e.act.kind === "decision") rec.decision = e.act.ok === false ? "rejected" : "accepted";
  }
  return rec;
}

/** Reads a typed call from the exchange: its run (given, or found among the newest), then its events, page by page. */
export async function readTyped(exchange: ExchangeRead, run: string, info?: RunInfo): Promise<TypedRecord | undefined> {
  let start = info;
  if (!start) {
    let after: string | undefined;
    for (let pages = 0; pages < 10 && !start; pages++) {
      const p = await exchange.runs({ limit: LIMIT_MAX, ...(after ? { after } : {}) });
      start = p.items.find((r) => r.run === run);
      after = p.next;
      if (!after) break;
    }
  }
  if (!start) return undefined;
  const events: ExchangeEvent[] = [];
  let after: string | undefined;
  for (let pages = 0; pages < 20; pages++) {
    const p = await exchange.events(run, { limit: LIMIT_MAX, ...(after ? { after } : {}) });
    events.push(...p.items);
    after = p.next;
    if (!after) break;
  }
  return typedOf(start, events);
}
