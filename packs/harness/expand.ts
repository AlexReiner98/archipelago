/**
 * A run's row opened in place: everything the exchange recorded for one
 * event, as labelled parts, each folded when long. Pure, so the tests
 * reach it without a page.
 *
 * - The map to the agent: what a node said or refused (whole), its node,
 *   place and pack; a gate's hold and why; for a Claude Code run, the whole
 *   block the agent got at that moment (got.ts), which holds a say's words,
 *   so they are not shown twice.
 * - The agent to the map: an act's kind, who did it, and its input and
 *   output field by field (a tool call's arguments, a `tell`'s words, an
 *   action's input, a prompt or a reply in full); whether it worked.
 * - A refusal that says how to fix its input (edition 11, `InputRefusal`):
 *   under its words, a `fix` part per path, what it wants and an example,
 *   and the input to send instead.
 */
import type { Json } from "../../spec/common.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";
import { FIX_MARK, fixIn } from "../action/input.ts";

/** One labelled piece of an opened row. */
export interface Part {
  label: string;
  text: string;
}

/** A value as text: a string as it is, anything else as indented JSON; a list of short rows (facts, `[op, id, field, value]`) a row a line. */
export function asText(v: Json | undefined): string {
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  const row = (x: Json) => Array.isArray(x) && x.every((c) => c === null || typeof c !== "object");
  if (Array.isArray(v) && v.length && v.every(row)) return `[\n${v.map((x) => `  ${JSON.stringify(x)}`).join(",\n")}\n]`;
  return JSON.stringify(v, null, 2);
}

/** A value split into parts by its top-level fields, or one part when it isn't an object. */
function fields(label: string, v: Json | undefined): Part[] {
  if (v === undefined || v === null || v === "") return [];
  if (typeof v === "object" && !Array.isArray(v)) {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined && x !== null && x !== "");
    if (!entries.length) return [];
    return entries.map(([k, x]) => ({ label: `${label}.${k}`, text: asText(x) }));
  }
  return [{ label, text: asText(v) }];
}

/** JSON text indented, when the whole of it is JSON; any other text as it is. */
export function pretty(text: string): string {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return text;
  try {
    return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    return text;
  }
}

/**
 * What a tool result says, when it is MCP's `{ content: [{ type: "text", text }] }`
 * or Claude Code's `{ stdout, stderr }`: the text itself, not its wrapping.
 */
function output(v: Json | undefined): Json | undefined {
  if (typeof v === "string") return pretty(v);
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, Json>;
    if (Array.isArray(o.content)) {
      const texts = o.content.map((c) => (c && typeof c === "object" && !Array.isArray(c) && typeof c.text === "string" ? c.text : asText(c)));
      return pretty(texts.join("\n"));
    }
  }
  return v;
}

/** Every part of one event, in the order it reads. `got`: the block the agent got at its moment (got.ts), after the words. */
export function expand(e: ExchangeEvent, got?: string): Part[] {
  const out: Part[] = [];
  const head = (label: string, text: string | undefined) => text && out.push({ label, text });
  if (e.act) {
    const a = e.act;
    head("act", `${a.kind} by ${a.by}${a.ok === false ? " · did not work" : ""}`);
    head("place", e.place);
    if (a.kind === "prompt" || a.kind === "reply") {
      // A prompt or a reply is its text, whichever field holds it.
      const text = typeof a.input === "string" ? a.input : typeof a.output === "string" ? a.output : undefined;
      if (text !== undefined) out.push({ label: a.kind, text });
      else out.push(...fields("input", a.input), ...fields("output", output(a.output)));
    } else {
      const said = output(a.output);
      const fix = typeof said === "string" ? fixIn(said) : undefined;
      // A refusal's fix line, read out of its words and shown as parts under them.
      const words = fix && typeof said === "string" ? said.split("\n").filter((l) => !l.startsWith(FIX_MARK)).join("\n") : said;
      out.push(...fields("input", a.input), ...fields("output", words));
      if (fix) {
        for (const f of fix.fix) out.push({ label: `fix ${f.path || "/"}`, text: `wants ${f.expected}\ne.g. ${JSON.stringify(f.example)}` });
        out.push({ label: "send instead", text: asText(fix.input) });
      }
    }
    head("pack", e.pack);
  } else {
    head("kind", e.kind);
    head("node", e.node);
    head("place", e.place);
    head("pack", e.pack);
    // A say's words are in the block the agent got, under its node's name: shown once, there.
    if (e.text && !(got && e.kind === "say")) out.push({ label: e.kind === "refuse" ? "refused" : e.kind === "say" ? "said" : "text", text: e.text });
    if (got) out.push({ label: "agent got", text: got });
  }
  if (e.detail !== undefined && e.detail !== null) out.push(...fields("detail", e.detail));
  head("at", `#${e.seq} · ${e.time}`);
  return out;
}

/** A long text's first lines, and how many lines are left out. */
export function fold(text: string, lines = 12, chars = 1200): { head: string; more: number } {
  const all = text.split("\n");
  let head = all.slice(0, lines).join("\n");
  let more = Math.max(0, all.length - lines);
  if (head.length > chars) {
    head = `${head.slice(0, chars)}…`;
    more = Math.max(more, 1);
  }
  return { head, more };
}
