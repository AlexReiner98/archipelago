/**
 * The contract table in spec/README.md, read from the spec itself: each
 * contract's capabilities (with the edition each came in, past the first),
 * the spec's EDITION, and the first sentence of the contract's doc. The
 * table sits between two markers; test/contracts.test.ts fails when it is
 * stale, and `node scripts/contracts.ts --write` writes it again.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Capability } from "../spec/common.ts";
import { EDITION } from "../spec/common.ts";
import { capabilities as declared } from "../spec/index.ts";

const SPEC = new URL("../spec/", import.meta.url);
export const README = new URL("README.md", SPEC);
export const START = "<!-- contracts: written by scripts/contracts.ts from the spec -->";
export const END = "<!-- /contracts -->";

export interface Contract { name: string; keys: Capability[]; first: string }

/** A doc's first sentence, after its title, with links kept as their text. */
function first(doc: string): string {
  const para = doc.split(/\n\s*\n/).find((p, i) => i > 0 && p.trim() && !p.startsWith("#")) ?? "";
  const text = para.replace(/\s+/g, " ").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").trim();
  return /^.*?[.:](?=\s|$)/.exec(text)?.[0].replace(/:$/, ".") ?? text;
}

/** Every contract: a spec doc beside a module, with the module's capabilities (none: a format). */
export async function contracts(): Promise<Contract[]> {
  const order = (c: Contract) => (c.keys.length ? declared.findIndex((d) => d.key === c.keys[0]!.key) : Infinity);
  const out: Contract[] = [];
  for (const file of readdirSync(SPEC).filter((f) => f.endsWith(".md") && f !== "README.md")) {
    const name = file.slice(0, -3);
    // A doc with no module beside it (frame: regions) is a contract with no capabilities, like a format.
    const ts = new URL(`${name}.ts`, SPEC);
    const mod = (existsSync(ts) ? await import(ts.href) : {}) as { capabilities?: Capability[] };
    out.push({ name, keys: mod.capabilities ?? [], first: first(readFileSync(new URL(file, SPEC), "utf8")) });
  }
  return out.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
}

export async function table(): Promise<string> {
  const rows = (await contracts()).map((c) => {
    const keys = c.keys.length ? c.keys.map((k) => `\`${k.key}\`${k.since > 1 ? ` (${k.since})` : ""}`).join(" ") : "(a format)";
    return `| [${c.name}](${c.name}.md) | ${keys} | ${c.first} |`;
  });
  return [
    START,
    `This is **edition ${EDITION}**. A capability that came after edition 1 shows the edition it came in.`,
    "",
    "| Contract | Capabilities | What it is |",
    "|---|---|---|",
    ...rows,
    "",
    END,
  ].join("\n");
}

/** The README with its table written now. */
export async function written(): Promise<string> {
  const text = readFileSync(README, "utf8").replace(/\r\n/g, "\n");
  const at = text.indexOf(START), end = text.indexOf(END);
  if (at < 0 || end < at) throw new Error(`spec/README.md needs the markers ${START} and ${END}`);
  return text.slice(0, at) + (await table()) + text.slice(end + END.length);
}

if (import.meta.url === new URL(process.argv[1]!, "file:").href || process.argv[1]?.endsWith("contracts.ts")) {
  if (process.argv.includes("--write")) writeFileSync(README, await written());
  else console.log(await table());
}
