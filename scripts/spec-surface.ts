/**
 * The spec's surface as it is in the files: each exported declaration of
 * `spec/*.ts`, printed without comments, keyed `file:name`. What the spec
 * says may only grow (capabilities, vocabulary terms, regions, keys) is
 * split into one entry per member (`file:name[member]`), so an edition
 * can add to it without touching what is already there. A contract's
 * `Capabilities` map is one too (`file:Capabilities[key]`, since edition
 * 10): an edition adds a capability to it, never changes one.
 *
 * `test/spec-frozen.test.ts` holds every accepted entry to its text in
 * `test/spec-frozen.json`. `node scripts/spec-surface.ts --accept` adds the
 * entries not frozen yet when an edition is accepted, and never rewrites
 * one that is. A word the spec renamed (RENAMED in spec/common.ts) is read
 * renamed in the frozen entries (`asNow`), so a rename changes no entry.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SPEC = fileURLToPath(new URL("../spec/", import.meta.url));
const FROZEN = fileURLToPath(new URL("../test/spec-frozen.json", import.meta.url));

/** Exports that name the edition the files are or the one accepted, or gather other modules: they move with every edition. */
const MOVING = new Set(["common.ts:EDITION", "common.ts:ACCEPTED", "index.ts:capabilities"]);

const printer = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed });

const isExported = (n: ts.Node): boolean =>
  ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

/** A member's own name in a list: its `key` or `term`, or a string literal itself. */
function memberName(e: ts.Expression): string | undefined {
  if (ts.isStringLiteral(e)) return e.text;
  if (!ts.isObjectLiteralExpression(e)) return undefined;
  for (const p of e.properties) {
    if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && (p.name.text === "key" || p.name.text === "term") && ts.isStringLiteral(p.initializer))
      return p.initializer.text;
  }
  return undefined;
}

/** A member as it is frozen: retiring one later adds `retired`, which is not a change of meaning. */
function frozenText(e: ts.Expression, sf: ts.SourceFile): string {
  if (ts.isObjectLiteralExpression(e)) {
    const kept = e.properties.filter((p) => !(ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "retired"));
    e = ts.factory.updateObjectLiteralExpression(e, kept);
  }
  return printer.printNode(ts.EmitHint.Expression, e, sf);
}

/** The list or record a const holds, under `as const` and `satisfies`. */
function inner(e: ts.Expression): ts.Expression {
  while (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
  return e;
}

export function surface(dir: string = SPEC): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts")).sort()) {
    const sf = ts.createSourceFile(file, readFileSync(dir + file, "utf8"), ts.ScriptTarget.Latest, true);
    for (const st of sf.statements) {
      if (!isExported(st)) continue;
      if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          const name = `${file}:${d.name.getText(sf)}`;
          if (MOVING.has(name)) continue;
          const init = d.initializer && inner(d.initializer);
          // A list of capabilities, terms or names: one entry each, so an edition can add to it.
          if (init && ts.isArrayLiteralExpression(init) && init.elements.length && init.elements.every((e) => memberName(e) !== undefined)) {
            if (d.type) out[`${name}:type`] = printer.printNode(ts.EmitHint.Unspecified, d.type, sf);
            for (const e of init.elements) out[`${name}[${memberName(e)}]`] = frozenText(e, sf);
            continue;
          }
          // A record of names (keys, tokens): each name is kept; a token's default look is the style's to change.
          if (init && ts.isObjectLiteralExpression(init)) {
            for (const p of init.properties) {
              if (!p.name) continue;
              const prop = p.name.getText(sf).replace(/^["']|["']$/g, "");
              out[`${name}.${prop}`] = file === "style.ts" ? prop : printer.printNode(ts.EmitHint.Unspecified, p, sf);
            }
            continue;
          }
          out[name] = printer.printNode(ts.EmitHint.Unspecified, d, sf);
        }
        continue;
      }
      // A contract's map of capabilities, key to interface: one entry each, as its list is.
      if (ts.isInterfaceDeclaration(st) && st.name.text === "Capabilities" && !st.heritageClauses?.length) {
        for (const m of st.members) if (m.name) out[`${file}:Capabilities[${m.name.getText(sf).replace(/^["']|["']$/g, "")}]`] = printer.printNode(ts.EmitHint.Unspecified, m, sf);
        continue;
      }
      const named = st as ts.Statement & { name?: ts.Identifier };
      if (named.name) out[`${file}:${named.name.text}`] = printer.printNode(ts.EmitHint.Unspecified, st, sf);
      else if (ts.isExportDeclaration(st)) out[`${file}:export ${st.getText(sf)}`] = printer.printNode(ts.EmitHint.Unspecified, st, sf);
    }
  }
  return out;
}

export interface Frozen {
  /** The edition the frozen entries were accepted up to. */
  accepted: number;
  entries: Record<string, string>;
}

export function readFrozen(): Frozen {
  return JSON.parse(readFileSync(FROZEN, "utf8")) as Frozen;
}

/** A rename's own entry keeps its old word: it is what says the word moved. */
const isRename = (key: string) => key.startsWith("common.ts:RENAMED[");

/**
 * The frozen entries as they read now: every word the spec renamed
 * (RENAMED in spec/common.ts) read renamed, in keys and text alike. The
 * entries stay as they were accepted; the rename is itself an entry.
 */
export async function asNow(frozen: Frozen): Promise<Record<string, string>> {
  const { renamed } = await import("../spec/common.ts");
  return Object.fromEntries(Object.entries(frozen.entries).map(([k, v]) => (isRename(k) ? [k, v] : [renamed(k), renamed(v)])));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes("--accept")) {
  const { EDITION } = await import("../spec/common.ts");
  let frozen: Frozen = { accepted: 0, entries: {} };
  try {
    frozen = readFrozen();
  } catch {}
  const now = surface();
  const read = await asNow(frozen);
  const added = Object.keys(now).filter((k) => !(k in read));
  for (const k of added) frozen.entries[k] = now[k]!;
  const sorted = Object.fromEntries(Object.entries(frozen.entries).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(FROZEN, `${JSON.stringify({ accepted: EDITION, entries: sorted }, null, 2)}\n`);
  console.log(`edition ${EDITION} accepted: ${added.length} entries frozen, ${Object.keys(sorted).length} in all`);
}
