/**
 * What the checks pack puts on the map: a rule, a test, and the four kinds
 * of link that make a test. A test `checks` one subject against one rule it
 * `applies`, may check it `against` a second subject, and may `need` other
 * tests first; `needs` is held acyclic, so the tests form a DAG.
 *
 * The subject is not the pack's: a domain names its type, or the rule
 * functions it judges (see index.ts). A test may check several subjects.
 */
import type { FlavourDef, LinkDef } from "../../spec/types.ts";

export const RULE = "rule";
export const TEST = "test";
export const CHECKS = "checks";
export const APPLIES = "applies";
export const NEEDS = "needs";
/** A two-subject test checks its subject against this one (a fit, a pair): a second subject under its older name. */
export const AGAINST = "against";
export const TEST_LINKS = [CHECKS, APPLIES, NEEDS, AGAINST] as const;

/** What a test's result can be. pending: not solved for its inputs now; blocked: it can't be solved as it stands. */
export const RESULTS = ["pending", "pass", "fail", "blocked", "error"] as const;
export type ResultKind = (typeof RESULTS)[number];

export const DECISIONS = ["accepted", "rejected"] as const;
export type Decision = (typeof DECISIONS)[number];

export const FLAVOURS: FlavourDef[] = [
  {
    name: RULE,
    base: "record",
    doc: "A check: a function a domain's judge knows by name, and its params.",
    fields: {
      fn: { kind: "text", doc: "The rule function's name, as the judge knows it." },
      params: { kind: "json", doc: "Its params: thresholds and the like." },
    },
    trial: false,
  },
  {
    name: TEST,
    base: "record",
    doc: "One subject checked against one rule, solved by the forward checker.",
    fields: {
      result: { kind: "choice", values: [...RESULTS], doc: "The result for the inputs at `version`." },
      findings: { kind: "json", doc: "What the judge found: where the subject fails the rule, with what was measured." },
      version: { kind: "text", doc: "The stamp of the inputs the result is for." },
      decision: { kind: "choice", values: [...DECISIONS], doc: "A person's accept or reject of the result." },
      decided_version: { kind: "text", doc: "The version the decision was made at; it is cleared when the version moves." },
      reads: { kind: "json", doc: "What its judge read (item fields, link pages, the day), as keys: the checker reads them again to tell whether its inputs moved." },
    },
    trial: false,
  },
];

export const LINKS: LinkDef[] = [
  { name: CHECKS, doc: "A test checks this subject: an item of any base.", from: ["record"] },
  { name: APPLIES, doc: "A test applies this rule.", from: ["record"], to: ["record"] },
  { name: NEEDS, doc: "A test needs this test to pass first. Held acyclic.", from: ["record"], to: ["record"] },
  { name: AGAINST, doc: "A two-subject test checks its subject against this one.", from: ["record"] },
];
