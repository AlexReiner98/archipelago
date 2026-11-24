/**
 * An input checked against an action's declared `input` schema, and what
 * would fix it (edition 11, `InputRefusal` in spec/action.ts). Pure, so
 * the harness reads a fix back out of a refusal's text with the same code.
 *
 * Checked: `type`, `required`, `properties`, `additionalProperties`,
 * `items`, `enum` and `const`. Anything else (`anyOf`, `$ref`, formats,
 * bounds) is the schema pack's, and passes here.
 */
import type { InputFix, InputRefusal, JsonSchema } from "../../spec/action.ts";
import type { Json } from "../../spec/common.ts";

type Obj = { [key: string]: Json };
const isObj = (v: Json | undefined): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const schemaOf = (v: Json | undefined): JsonSchema | undefined => (isObj(v) ? v : undefined);

/** A JSON Pointer segment. */
const seg = (k: string | number) => `/${String(k).replace(/~/g, "~0").replace(/\//g, "~1")}`;

const typesOf = (s: JsonSchema): string[] => (typeof s.type === "string" ? [s.type] : Array.isArray(s.type) ? s.type.filter((t): t is string => typeof t === "string") : []);

function fits(type: string, v: Json): boolean {
  switch (type) {
    case "string": return typeof v === "string";
    case "number": return typeof v === "number" && Number.isFinite(v);
    case "integer": return typeof v === "number" && Number.isInteger(v);
    case "boolean": return typeof v === "boolean";
    case "array": return Array.isArray(v);
    case "object": return isObj(v);
    case "null": return v === null;
    default: return true;
  }
}

const A: Record<string, string> = { string: "a string", number: "a number", integer: "a whole number", boolean: "true or false", array: "a list", object: "an object", null: "null" };

/** The schema's wish in words. */
function words(s: JsonSchema): string {
  if ("const" in s) return `exactly ${JSON.stringify(s.const)}`;
  if (Array.isArray(s.enum)) return `one of ${s.enum.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ")}`;
  const t = typesOf(s);
  const named = t.map((x) => A[x] ?? x).join(" or ");
  if (t.length === 1 && t[0] === "array" && schemaOf(s.items) && typesOf(schemaOf(s.items)!).length) return `a list, each ${words(schemaOf(s.items)!)}`;
  return named || "a value";
}

/** A value that passes `s`, from what was given when it can be turned into one (`v`), else from the schema. */
export function example(s: JsonSchema, v?: Json, name?: string): Json {
  if ("const" in s) return s.const as Json;
  if (Array.isArray(s.enum) && s.enum.length) return s.enum.includes(v as Json) ? (v as Json) : s.enum[0]!;
  if (Array.isArray(s.examples) && s.examples.length) return s.examples[0]!;
  if ("default" in s) return s.default as Json;
  const t = typesOf(s);
  // What was given, turned into the wanted type where that is plain.
  if (v !== undefined) {
    for (const type of t) {
      if (fits(type, v)) return v;
      if (type === "string" && (typeof v === "number" || typeof v === "boolean")) return String(v);
      if ((type === "number" || type === "integer") && typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
        const n = Number(v);
        if (type === "number" || Number.isInteger(n)) return n;
      }
      if (type === "boolean" && (v === "true" || v === "false")) return v === "true";
      if (type === "array" && !Array.isArray(v) && v !== null) {
        const items = schemaOf(s.items);
        if (!items || !typesOf(items).length || typesOf(items).some((x) => fits(x, v))) return [v];
      }
    }
  }
  switch (t[0]) {
    case "string": return `<${name ?? "text"}>`;
    case "number":
    case "integer": return typeof s.minimum === "number" ? s.minimum : 0;
    case "boolean": return false;
    case "null": return null;
    case "array": {
      const items = schemaOf(s.items);
      return typeof s.minItems === "number" && s.minItems > 0 && items ? [example(items, undefined, name)] : [];
    }
    case "object": {
      const out: Obj = {};
      const props = schemaOf(s.properties) ?? {};
      for (const k of Array.isArray(s.required) ? s.required : []) {
        if (typeof k === "string") out[k] = example(schemaOf(props[k]) ?? {}, undefined, k);
      }
      return out;
    }
    default: return null;
  }
}

function walk(s: JsonSchema, v: Json, path: string, name: string | undefined, out: InputFix[]): void {
  const t = typesOf(s);
  if (("const" in s && JSON.stringify(s.const) !== JSON.stringify(v)) || (Array.isArray(s.enum) && !s.enum.some((x) => JSON.stringify(x) === JSON.stringify(v))) || (t.length && !t.some((x) => fits(x, v)))) {
    out.push({ path, expected: words(s), example: example(s, v, name) });
    return;
  }
  if (isObj(v)) {
    const props = schemaOf(s.properties) ?? {};
    for (const k of Array.isArray(s.required) ? s.required : []) {
      if (typeof k === "string" && !(k in v)) out.push({ path: path + seg(k), expected: `${words(schemaOf(props[k]) ?? {})}: it is required`, example: example(schemaOf(props[k]) ?? {}, undefined, k) });
    }
    for (const [k, x] of Object.entries(v)) {
      const p = schemaOf(props[k]);
      if (p) walk(p, x, path + seg(k), k, out);
      else if (s.additionalProperties === false) {
        const known = Object.keys(props);
        out.push({ path: path + seg(k), expected: `not here: it takes ${known.join(", ") || "nothing"}`, example: null });
      } else if (schemaOf(s.additionalProperties)) walk(schemaOf(s.additionalProperties)!, x, path + seg(k), k, out);
    }
  } else if (Array.isArray(v) && schemaOf(s.items)) {
    v.forEach((x, i) => walk(schemaOf(s.items)!, x, path + seg(i), name, out));
  }
}

/** The input with every fix applied: a key that should go is taken out, the rest set to their example. */
function applied(input: Json, fix: InputFix[]): Json {
  let root: Json = structuredClone(input);
  for (const f of fix) {
    if (f.path === "") {
      root = f.example;
      continue;
    }
    const keys = f.path.slice(1).split("/").map((k) => k.replace(/~1/g, "/").replace(/~0/g, "~"));
    let at: Json = root;
    for (const k of keys.slice(0, -1)) at = Array.isArray(at) ? at[Number(k)]! : isObj(at) ? at[k]! : null;
    const last = keys[keys.length - 1]!;
    const gone = f.expected.startsWith("not here");
    if (Array.isArray(at)) at[Number(last)] = f.example;
    else if (isObj(at)) {
      if (gone) delete at[last];
      else at[last] = f.example;
    }
  }
  return root;
}

/** What is wrong with `input` under `schema`, and the input fixed; undefined when it fits. */
export function check(schema: JsonSchema, input: Json): InputRefusal | undefined {
  const fix: InputFix[] = [];
  walk(schema, input, "", undefined, fix);
  return fix.length ? { fix, input: applied(input, fix) } : undefined;
}

/** The refusal's message: each place and what it wants. */
export function message(action: string, r: InputRefusal): string {
  return `${action}: ${r.fix.map((f) => `${f.path || "the input"} wants ${f.expected}`).join("; ")}.`;
}

/** How a fix is written after a refusal's words, for an agent to read and the harness to read back. */
export const FIX_MARK = "fix: ";

/** The fix as one line, after the refusal's words. */
export const fixLine = (r: InputRefusal): string => `${FIX_MARK}${JSON.stringify(r)}`;

/** The fix written in a refusal's text (`fixLine`), if there is one. */
export function fixIn(text: string): InputRefusal | undefined {
  const line = text.split("\n").find((l) => l.startsWith(FIX_MARK));
  if (!line) return undefined;
  try {
    const r = JSON.parse(line.slice(FIX_MARK.length)) as InputRefusal;
    return Array.isArray(r?.fix) ? r : undefined;
  } catch {
    return undefined;
  }
}
