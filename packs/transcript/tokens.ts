/**
 * Token use and compactions, as pure parts: each of the model's messages'
 * `usage` and each `compact_boundary`, read record by record from the
 * transcript (read.ts). Numbers only: no text is kept.
 */
import type { Line } from "./read.ts";

/** What one of the model's messages used, as its `message.usage` says: real tokens. */
export interface Usage {
  /** Its place in the transcript: rows count from 1, in the order they were written. */
  n: number;
  kind: "usage";
  time?: string;
  model?: string;
  /** Tokens sent fresh, read from the cache, written to the cache, and answered. */
  input: number;
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** A compaction: the window summed up and begun again (`compact_boundary`). */
export interface Compaction {
  n: number;
  kind: "compact";
  time?: string;
  /** `auto` or `manual`. */
  trigger?: string;
  /** Tokens in the window before and after, and dropped so far in the run. */
  pre?: number;
  post?: number;
  dropped?: number;
}

export type TokenRow = Usage | Compaction;

/** The most rows kept; older usage drops off first, compactions stay. */
export const TOKENS_MAX = 20_000;

const count = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : 0);

/** The tokens in the window as of a message: what it was sent, and what it answered. */
export const windowOf = (u: Usage) => u.input + u.cacheRead + u.cacheWrite + u.output;

/**
 * Token use and compactions, record by record, in the order they were
 * written. A message streamed as several records counts once (its id),
 * the latest usage winning. Numbers only: no text is kept.
 */
export class TokenIndex {
  private list: TokenRow[] = [];
  private byMessage = new Map<string, Usage>();
  private n = 0;

  add(line: Line): void {
    try {
      const e = JSON.parse(line.text);
      if (e && typeof e === "object" && !e.isSidechain) this.take(e);
    } catch {}
  }

  /** One parsed record. */
  take(e: any): void {
    const time = typeof e?.timestamp === "string" ? e.timestamp : undefined;
    if (e?.type === "assistant" && e.message?.usage && typeof e.message.usage === "object") {
      const u = e.message.usage;
      const id = typeof e.message.id === "string" ? e.message.id : undefined;
      const had = id ? this.byMessage.get(id) : undefined;
      const at = had?.time ?? time;
      const row: Usage = {
        n: had?.n ?? ++this.n,
        kind: "usage",
        ...(at ? { time: at } : {}),
        ...(typeof e.message.model === "string" ? { model: e.message.model } : {}),
        input: count(u.input_tokens),
        cacheRead: count(u.cache_read_input_tokens),
        cacheWrite: count(u.cache_creation_input_tokens),
        output: count(u.output_tokens),
      };
      if (had) Object.assign(had, row);
      else {
        this.list.push(row);
        if (id) this.byMessage.set(id, row);
        this.trim();
      }
      return;
    }
    if (e?.type === "system" && e.subtype === "compact_boundary") {
      const m = e.compactMetadata && typeof e.compactMetadata === "object" ? e.compactMetadata : {};
      this.list.push({
        n: ++this.n,
        kind: "compact",
        ...(time ? { time } : {}),
        ...(typeof m.trigger === "string" ? { trigger: m.trigger } : {}),
        ...(typeof m.preTokens === "number" ? { pre: m.preTokens } : {}),
        ...(typeof m.postTokens === "number" ? { post: m.postTokens } : {}),
        ...(typeof m.cumulativeDroppedTokens === "number" ? { dropped: m.cumulativeDroppedTokens } : {}),
      });
    }
  }

  /** Every row, in order. */
  rows(): readonly TokenRow[] {
    return this.list;
  }

  private trim() {
    if (this.list.length <= TOKENS_MAX) return;
    const i = this.list.findIndex((r) => r.kind === "usage");
    if (i < 0) return;
    const [gone] = this.list.splice(i, 1);
    for (const [id, u] of this.byMessage) if (u === gone) this.byMessage.delete(id);
  }
}

/**
 * A page of rows: of one kind, written up to `until` (a time), after the
 * place `after`. With the latest usage up to `until`, and how many
 * compactions came by then, whatever the page.
 */
export function tokensPage(rows: readonly TokenRow[], q: { kind?: "usage" | "compact"; until?: string; after?: number; limit: number }) {
  const until = q.until ? Date.parse(q.until) : NaN;
  const upTo = rows.filter((r) => Number.isNaN(until) || !r.time || Date.parse(r.time) <= until);
  let last: Usage | undefined;
  let compactions = 0;
  for (const r of upTo) {
    if (r.kind === "usage") last = r;
    else compactions++;
  }
  const from = upTo.filter((r) => (!q.kind || r.kind === q.kind) && (q.after === undefined || r.n > q.after));
  const page = from.slice(0, q.limit);
  return { rows: page, ...(from.length > q.limit ? { next: page[page.length - 1]!.n } : {}), ...(last ? { last } : {}), compactions };
}
