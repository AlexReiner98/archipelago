/**
 * What people's decisions say about each rule, apart from the runtime: the
 * findings people rejected (not a problem, by their judgement) and accepted
 * (a real problem), each with its measured value, and the limit that would
 * have spared every rejection while still catching every acceptance.
 *
 * A domain says, per rule function, which param is its limit and which
 * side fails (`RuleLimit`), so this reads no function by name. A finding
 * counts when it carries a number `measured`; a decision counts only at the
 * version it was made at.
 */
import type { Json } from "../../spec/common.ts";
import type { Item } from "../../spec/graph.ts";
import type { Decision } from "./types.ts";

/** A rule function's limit: the param that is its threshold, and which side of it fails. */
export interface RuleLimit {
  fn: string;
  limit: string;
  fails: "below" | "above";
}

export interface Decided {
  test: string;
  title: string;
  rule: string;
  decision: Decision;
  measured: number[];
}

export interface RuleReading {
  rule: string;
  title: string;
  fn: string;
  param: string;
  fails: "below" | "above";
  current: number | null;
  rejected: { test: string; title: string; measured: number }[];
  accepted: { test: string; title: string; measured: number }[];
  /** The limit nearest the current one that clears every rejection and keeps every acceptance; null when none does. */
  proposal: number | null;
  /** Why there is no proposal, or what it costs. */
  note: string;
}

/** A test as a decision that counts: decided at its version now, with a rule and measured findings; else undefined. */
export function decidedOf(test: Item, rule: string | undefined): Decided | undefined {
  const f = test.fields;
  if (!rule || (f.decision !== "accepted" && f.decision !== "rejected") || f.decided_version !== f.version) return undefined;
  const measured = (Array.isArray(f.findings) ? f.findings : []).flatMap((x: Json) =>
    x && typeof x === "object" && !Array.isArray(x) && typeof x.measured === "number" ? [x.measured] : [],
  );
  if (!measured.length) return undefined;
  return { test: test.id, title: String(f.title ?? test.id), rule, decision: f.decision, measured };
}

export function read(rules: { id: string; title: string; fn?: string; params?: unknown }[], fns: RuleLimit[], decided: Decided[]): RuleReading[] {
  const out: RuleReading[] = [];
  for (const r of rules) {
    const info = fns.find((f) => f.fn === r.fn);
    const mine = decided.filter((d) => d.rule === r.id);
    if (!info || !mine.length) continue;
    const params = (r.params ?? {}) as Record<string, unknown>;
    const current = typeof params[info.limit] === "number" ? (params[info.limit] as number) : null;
    const flat = (kind: Decision) => mine.filter((d) => d.decision === kind).flatMap((d) => d.measured.map((m) => ({ test: d.test, title: d.title, measured: m })));
    const rejected = flat("rejected");
    const accepted = flat("accepted");
    let proposal: number | null = null;
    let note: string;
    if (!rejected.length) note = "Nothing rejected: the rule stands.";
    else if (info.fails === "below") {
      // A finding is measured < limit. Spare the rejected: limit <= their least. Keep the accepted: limit > their most.
      const spare = Math.min(...rejected.map((x) => x.measured));
      const keep = accepted.length ? Math.max(...accepted.map((x) => x.measured)) : -Infinity;
      if (spare > keep) {
        proposal = spare;
        note = accepted.length ? `Lowering ${info.limit} to ${spare} spares every rejection and still catches ${accepted.length} accepted.` : `Lowering ${info.limit} to ${spare} spares every rejection; nothing accepted to keep.`;
      } else note = `No ${info.limit} spares the rejected (${spare}) and keeps the accepted (${keep}): people disagree with the rule in a way a threshold can't say.`;
    } else {
      const spare = Math.max(...rejected.map((x) => x.measured));
      const keep = accepted.length ? Math.min(...accepted.map((x) => x.measured)) : Infinity;
      if (spare < keep) {
        proposal = spare;
        note = accepted.length ? `Raising ${info.limit} to ${spare} spares every rejection and still catches ${accepted.length} accepted.` : `Raising ${info.limit} to ${spare} spares every rejection; nothing accepted to keep.`;
      } else note = `No ${info.limit} spares the rejected (${spare}) and keeps the accepted (${keep}): people disagree with the rule in a way a threshold can't say.`;
    }
    out.push({ rule: r.id, title: r.title, fn: info.fn, param: info.limit, fails: info.fails, current, rejected, accepted, proposal, note });
  }
  return out;
}
