/**
 * Map lint's rule functions, apart from the runtime: each judges one item
 * of the map by what it reads through the checks plugin's tracked reader, so
 * the test's stamp is exactly what it looked at. A rule on the map names
 * one by `fn` and gives its `params`; the thresholds are data.
 *
 * Every function takes `statuses` (optional): it checks an item only while
 * its status is one of them, and passes it otherwise (a done task needs no
 * owner). A finding carries `key`, its identity, so a decision on it is
 * carried while it is still found.
 */
import type { Json } from "../../spec/common.ts";
import type { JudgeCall, Verdict } from "../checks/checker.ts";

export interface LintFn {
  name: string;
  doc: string;
  /** Its params, documented. */
  params: Record<string, string>;
  /** The param that is its threshold, for the rejections reading. */
  limit?: { limit: string; fails: "below" | "above" };
  judge(call: JudgeCall): Promise<Verdict>;
}

type P = Record<string, Json>;
const pass: Verdict = { passed: true, findings: [] };
const DAY = 864e5;

/** Whether the item is one this rule checks now, by `statuses`. */
const checked = (call: JudgeCall) => {
  const only = (call.params as P | null)?.statuses;
  return !Array.isArray(only) || only.includes(call.subject.fields.status ?? null);
};

export const FNS: LintFn[] = [
  {
    name: "lint.has",
    doc: "The item has a value in `field` (a text that isn't blank, or any other value).",
    params: { field: "The field it must have.", statuses: "Optional: check only items with one of these statuses." },
    async judge(call) {
      if (!checked(call)) return pass;
      const field = String((call.params as P).field ?? "");
      const v = call.subject.fields[field];
      const has = v !== undefined && v !== null && !(typeof v === "string" && !v.trim());
      return has ? pass : { passed: false, findings: [{ key: `field:${field}`, field, message: `No ${field}.` }] };
    },
  },
  {
    name: "lint.linked",
    doc: "The item has at least `min` links of kind `link`, out from it (or in, with `dir: in`).",
    params: { link: "The kind of link.", dir: "out (default) or in.", min: "How many at least; default 1.", statuses: "Optional: check only items with one of these statuses." },
    limit: { limit: "min", fails: "below" },
    async judge(call) {
      if (!checked(call)) return pass;
      const p = call.params as P;
      const link = String(p.link ?? "");
      const dir = p.dir === "in" ? "in" : "out";
      const min = typeof p.min === "number" ? p.min : 1;
      // Read only as many as it needs: a page of `min`, so a further link moves nothing.
      const page = await call.read!.links(call.subject.id, { type: link, dir }, { limit: Math.max(1, min) });
      const n = page.items.length;
      if (n >= min) return pass;
      return { passed: false, findings: [{ key: `link:${link}:${dir}`, link, dir, measured: n, limit: min, message: n ? `Only ${n} ${link} ${dir === "out" ? "from" : "to"} it; ${min} wanted.` : `Nothing ${dir === "out" ? `it is ${link}` : `${link} it`}.` }] };
    },
  },
  {
    name: "lint.overdue",
    doc: "The item isn't past its `due` date by more than `grace_days` days. Reads the day, so it is solved again when the day turns.",
    params: { grace_days: "Days past due it may be; default 0.", statuses: "Optional: check only items with one of these statuses." },
    limit: { limit: "grace_days", fails: "above" },
    async judge(call) {
      if (!checked(call)) return pass;
      const due = call.subject.fields.due;
      if (typeof due !== "string" || Number.isNaN(Date.parse(due))) return pass;
      const grace = typeof (call.params as P).grace_days === "number" ? ((call.params as P).grace_days as number) : 0;
      const over = Math.floor((Date.parse(call.read!.today()) - Date.parse(due.slice(0, 10))) / DAY);
      if (over <= grace) return pass;
      return { passed: false, findings: [{ key: "field:due", field: "due", measured: over, limit: grace, message: `${over} days past due (${due.slice(0, 10)}).` }] };
    },
  },
];

/** A lint finding's identity: its `key`. */
export const finding = (f: Json): string | undefined => (f && typeof f === "object" && !Array.isArray(f) && typeof f.key === "string" ? f.key : undefined);
