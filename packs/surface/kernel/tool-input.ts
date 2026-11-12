// A pack's tool declares its input as a JSON shape (docs/kernel-packs.md, "Service names": the shape sketch), since a
// pack's module imports nothing of the kernel, zod included; the surface builds the zod schema from it where the tools
// are registered (./tools.ts), so what an agent is told of a tool and what its input is checked by are as they were.
//
// A shape is "string", "number", "boolean", "id" (a string), "any", [shape] (a list of it), { "key": shape, "key?":
// shape } (an object, `key?` optional), or a list of two or more strings: one of those words (an enum). What a field
// is for is said beside the shape, in `says`, by its path ("authority", "authority.of").

import { z } from 'zod';
import type { Actor, Archipelago } from '../../write/kernel/pelago.ts';
import type { Tool } from './tools.ts';

/** A JSON sketch of a tool's input value. */
export type InputShape = 'string' | 'number' | 'boolean' | 'id' | 'any' | InputShape[] | string[] | { [key: string]: InputShape };

/**
 * A tool as a pack declares it: its input a shape (checked as it is built: a pack's module has no type of the
 * surface's to declare it with), its run handed whatever context the adapter at its old path builds.
 */
export interface DeclaredTool<C = unknown> extends Omit<Tool, 'input' | 'run'> {
  input: Record<string, unknown>;
  /** What each field is for, by its path. */
  says?: Record<string, string>;
  run(ctx: C, actor: Actor, input: any): Promise<unknown>;
}

const SCALARS = new Set(['string', 'number', 'boolean', 'id', 'any']);
const isEnum = (s: unknown): s is string[] => Array.isArray(s) && s.length > 1 && s.every((w) => typeof w === 'string' && !SCALARS.has(w));

/** The zod schema of one shape, at a path, its description from `says`. */
function zodOf(shape: InputShape, says: Record<string, string>, path: string, optional: boolean): z.ZodType {
  let made: z.ZodType;
  if (typeof shape === 'string') {
    if (!SCALARS.has(shape)) throw new Error(`${path}: "${shape}" is no shape`);
    made = shape === 'number' ? z.number() : shape === 'boolean' ? z.boolean() : shape === 'any' ? z.any() : z.string();
  } else if (isEnum(shape)) made = z.enum(shape as [string, ...string[]]);
  else if (Array.isArray(shape)) {
    if (shape.length !== 1) throw new Error(`${path}: a list's shape is one shape, as [shape]`);
    made = z.array(zodOf(shape[0] as InputShape, says, `${path}[]`, false));
  } else made = z.object(shapeOf(shape, says, path));
  if (optional) made = made.optional();
  const said = says[path];
  return said === undefined ? made : made.describe(said);
}

/** An object shape's fields as zod's raw shape: `key?` optional. */
function shapeOf(shape: Record<string, InputShape>, says: Record<string, string>, at = ''): z.ZodRawShape {
  return Object.fromEntries(Object.entries(shape).map(([key, s]) => {
    const name = key.replace(/\?$/, '');
    return [name, zodOf(s, says, at ? `${at}.${name}` : name, key.endsWith('?'))];
  }));
}

/** A declared input as the zod shape a Tool's input is. */
export const inputOf = (input: Record<string, unknown>, says: Record<string, string> = {}): z.ZodRawShape => shapeOf(input as Record<string, InputShape>, says);

/**
 * A pack's declared tools as the surface's: each input built as zod, and each run handed the context `ctxOf` makes of
 * the map it is called on (the pack's, made by the adapter at the module's old path).
 */
export function declaredTools<C>(tools: Record<string, DeclaredTool<C>>, ctxOf: (l: Archipelago) => C | Promise<C>): Record<string, Tool> {
  return Object.fromEntries(Object.entries(tools).map(([name, { input, says, run, ...rest }]): [string, Tool] => [name, { ...rest, input: inputOf(input, says), run: async (l, actor, given) => run(await ctxOf(l), actor, given) }]));
}
