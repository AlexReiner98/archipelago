/**
 * What the Then view says, pure (view.ts draws it): the points the quick
 * picks stand for, a value in a few words, and a diff's count by kind.
 */
import type { Json } from "../../spec/common.ts";
import type { Difference } from "./journal.ts";

/** The quick picks for `from`: an hour ago, the start of today (local), a week ago. */
export type Quick = "hour" | "today" | "week";

/** The ISO instant a quick pick stands for, at `now` (ms). */
export function pickAt(pick: Quick, now: number): string {
  if (pick === "hour") return new Date(now - 3_600_000).toISOString();
  if (pick === "week") return new Date(now - 7 * 86_400_000).toISOString();
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/** A value in at most `n` characters; ∅ for none. */
export function shown(v: Json | undefined, n = 60): string {
  if (v === undefined || v === null) return "∅";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** How many items of a page were made, changed and gone. */
export function counts(items: readonly Pick<Difference, "change">[]): { made: number; changed: number; gone: number } {
  const out = { made: 0, changed: 0, gone: 0 };
  for (const x of items) out[x.change]++;
  return out;
}

/** The mark a difference is drawn with. */
export const MARK: Record<Difference["change"], string> = { made: "+", changed: "~", gone: "−" };
