// Service names (docs/kernel-packs.md, "Service names"): `service:<family>.<name>` names a function one in-process pack
// provides and others call. Each closed list the kernel kept opens as a family: a lens preset's answer, a lens term, a
// capability's behaviour, a workspace setting, a piece or page the screen draws, an action whose code is in-process.
//
// - One owner. A name the kernel still answers itself (KERNEL_SERVICES) is the kernel's; two active packs providing
//   one name are refused as two declaring one type are (src/packorder.ts, orderPacks).
// - Checked by shape. A provider's `in` may require no field the caller's declared `in` lacks, and its `out` must hold
//   every field the caller's declared `out` reads: more, never less, as `field:` is checked (meets).
//
// A pack declares what it provides and what it calls under its manifest's `kernel` key, read here loosely: the
// manifest's own check of the key is src/manifest.ts's. What fills a name at run time is the loader's: it binds each
// provider's function to the pack's context and hands the table to fillServices when the registry loads.

import type { PackFile } from './packs.ts';

/** A JSON sketch of a value: a scalar's name, a list of one shape, or an object whose `key?` is optional. */
export type Shape = 'string' | 'number' | 'boolean' | 'id' | 'any' | Shape[] | { [key: string]: Shape };

/** What a service takes and answers. A setting says its value's shape as `out`, and who may read it. */
export interface Signature {
  in?: Shape;
  out?: Shape;
  /** For a setting: whether every member reads it (it is then kept as `member.<key>`, src/schema.ts), or only an admin. */
  read?: 'member' | 'admin';
}

/** The part of a pack's `kernel` key this reads: the names it provides and the shapes it calls names with. */
export interface KernelNames {
  provides?: Record<string, Signature>;
  calls?: Record<string, Signature>;
}

/** The families a service name opens, each a closed list the kernel kept. */
export const FAMILIES = ['answer', 'term', 'capability', 'setting', 'piece', 'page', 'act'] as const;
export type Family = (typeof FAMILIES)[number];

/** The lens terms the kernel still reads itself (src/query-terms.ts): frontier, worked, moved, island, held. */
export const KERNEL_TERMS = ['held', 'moved', 'frontier', 'worked', 'island'] as const;

/** The settings the kernel keeps itself (src/workspace-tools.ts), beside the lifts of core's rules (src/rules.ts, LIFTS): a pack's setting names none of them. */
export const KERNEL_SETTINGS = ['me', 'name', 'default_visibility', 'drawings_open', 'holds_off', 'islands', 'lifted', 'asks_at'];

/** A pack's `kernel` names, or none. */
export const kernelOf = (pack: object): KernelNames => {
  const k = (pack as { kernel?: unknown }).kernel;
  return k && typeof k === 'object' ? (k as KernelNames) : {};
};

/** The family and the entry a service name is of: `answer.attention` is the answer attention. Undefined for no service name. */
export function serviceName(name: string): { family: Family; entry: string } | undefined {
  const at = name.indexOf('.');
  const family = name.slice(0, at) as Family;
  const entry = name.slice(at + 1);
  return at > 0 && FAMILIES.includes(family) && /^[a-z][a-z0-9_.-]*$/.test(entry) ? { family, entry } : undefined;
}

/** Why a shape is no shape, or undefined when it is one. */
export function shapeProblem(shape: unknown, at = 'shape'): string | undefined {
  if (typeof shape === 'string') return ['string', 'number', 'boolean', 'id', 'any'].includes(shape) ? undefined : `${at}: "${shape}" is no shape: string, number, boolean, id, any, [shape] or { key: shape }`;
  if (Array.isArray(shape)) return shape.length === 1 ? shapeProblem(shape[0], `${at}[]`) : `${at}: a list's shape is one shape, as [shape]`;
  if (shape && typeof shape === 'object') {
    for (const [key, s] of Object.entries(shape)) {
      if (!/^[A-Za-z_][\w]*\??$/.test(key)) return `${at}: "${key}" is no field's name`;
      const why = shapeProblem(s, `${at}.${key}`);
      if (why) return why;
    }
    return undefined;
  }
  return `${at}: ${JSON.stringify(shape)} is no shape`;
}

const fieldsOf = (shape: Shape | undefined) => {
  const out = new Map<string, { shape: Shape; optional: boolean }>();
  if (shape && typeof shape === 'object' && !Array.isArray(shape)) for (const [k, s] of Object.entries(shape)) out.set(k.replace(/\?$/, ''), { shape: s, optional: k.endsWith('?') });
  return out;
};
const isObject = (s: Shape | undefined): s is { [key: string]: Shape } => !!s && typeof s === 'object' && !Array.isArray(s);

/**
 * Why a value of shape `given` does not serve where `wanted` is read, or undefined when it does: any takes and gives
 * anything, an id is a string, a list holds what its element does, and an object holds every field read of it (its
 * optional ones, where it has them, of the shape read).
 */
export function fits(given: Shape | undefined, wanted: Shape | undefined, at = ''): string | undefined {
  if (wanted === undefined || wanted === 'any' || given === 'any') return undefined;
  if (given === undefined) return `${at || 'it'} is not there`;
  if (typeof wanted === 'string') return given === wanted || (wanted === 'string' && given === 'id') ? undefined : `${at || 'it'} is ${JSON.stringify(given)}, not ${wanted}`;
  if (Array.isArray(wanted)) return Array.isArray(given) ? fits(given[0], wanted[0], `${at}[]`) : `${at || 'it'} is no list`;
  if (!isObject(given)) return `${at || 'it'} is no object`;
  const has = fieldsOf(given);
  for (const [key, w] of fieldsOf(wanted)) {
    const g = has.get(key);
    const here = at ? `${at}.${key}` : key;
    if (!g || g.optional) { if (!w.optional) return `${here} is not there`; if (!g) continue; }
    const why = fits(g.shape, w.shape, here);
    if (why) return why;
  }
  return undefined;
}

/**
 * Why a provider does not meet what a caller declared it calls with, or undefined when it does: what the caller sends
 * must fill every field the provider requires, and what the provider answers must hold every field the caller reads.
 */
export function meets(provider: Signature, caller: Signature): string | undefined {
  const sent = fits(caller.in, provider.in);
  if (sent) return `its in wants what the caller does not send: ${sent}`;
  const answered = fits(provider.out, caller.out);
  return answered ? `its out lacks what the caller reads: ${answered}` : undefined;
}

/** Why a value is not of a shape, or undefined when it is: an id is a string here, and an object's other fields are let be. */
export function valueProblem(value: unknown, shape: Shape, at = 'it'): string | undefined {
  if (shape === 'any') return undefined;
  if (shape === 'id' || shape === 'string' || shape === 'number' || shape === 'boolean') return typeof value === (shape === 'id' ? 'string' : shape) ? undefined : `${at} is ${shape === 'id' ? 'an id' : `a ${shape}`}`;
  if (Array.isArray(shape)) return Array.isArray(value) ? value.map((v, i) => valueProblem(v, shape[0], `${at}[${i}]`)).find(Boolean) : `${at} is a list`;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return `${at} is an object`;
  for (const [key, f] of fieldsOf(shape)) {
    const v = (value as Record<string, unknown>)[key];
    if (v === undefined) { if (!f.optional) return `${at}.${key} is not there`; continue; }
    const why = valueProblem(v, f.shape, `${at}.${key}`);
    if (why) return why;
  }
  return undefined;
}

/** The service names a pack provides. */
export const providedBy = (pack: object): string[] => Object.keys(kernelOf(pack).provides ?? {});

/** The entries of one family the packs provide, by entry: `capability` gives each capability a pack adds. */
export const providedOf = (packs: Iterable<object>, family: Family): string[] =>
  [...packs].flatMap((p) => providedBy(p).flatMap((n) => (serviceName(n)?.family === family ? [serviceName(n)!.entry] : [])));

/**
 * The entries of a family a pack may name: those it provides itself, and those it requires or uses as a service
 * (whose provider is then active wherever the pack is: src/packorder.ts).
 */
export function openedTo(pack: PackFile, family: Family): string[] {
  const asked = [...(pack.requires ?? []), ...(pack.uses ?? [])].flatMap((n) => (n.startsWith('service:') ? [n.slice('service:'.length)] : []));
  return [...providedBy(pack), ...asked].flatMap((n) => (serviceName(n)?.family === family ? [serviceName(n)!.entry] : []));
}

/** Problems with what a pack provides and calls, given the names each family's kernel still answers itself. Empty means they hold. */
export function checkServices(pack: object, kernelOwns: Record<Family, readonly string[]>): string[] {
  const problems: string[] = [];
  const { provides, calls } = kernelOf(pack);
  for (const [what, list] of Object.entries({ provides, calls })) {
    for (const [name, sig] of Object.entries(list ?? {})) {
      const at = `kernel.${what} "${name}"`;
      const s = serviceName(name);
      if (!s) { problems.push(`${at} is no service name: <family>.<name>, its family one of ${FAMILIES.join(', ')}`); continue; }
      if (!sig || typeof sig !== 'object') { problems.push(`${at} is { in, out }, each a shape`); continue; }
      for (const side of ['in', 'out'] as const) if (sig[side] !== undefined) { const why = shapeProblem(sig[side], `${at}.${side}`); if (why) problems.push(why); }
      if (what === 'provides' && kernelOwns[s.family].includes(s.entry)) problems.push(`${at}: the kernel answers ${s.family} "${s.entry}" itself: one name, one owner`);
      if (s.family === 'setting' && what === 'provides' && (sig.out === undefined || !['member', 'admin'].includes(sig.read ?? ''))) problems.push(`${at}: a setting says its value's shape as out, and who reads it (read: member or admin)`);
      if (s.family !== 'setting' && sig.read !== undefined) problems.push(`${at}: only a setting says who reads it`);
    }
  }
  return problems;
}

/** A provider's function, bound by the loader to its pack's context: input in, answer out. */
export type ServiceFn = (input: unknown) => Promise<unknown>;

/** What fills each service name, by the registry it was loaded for: a new load is a new table. */
const tables = new WeakMap<object, Map<string, ServiceFn>>();

/** Hand a registry the functions that fill its service names (the loader, when the registry loads). */
export function fillServices(registry: object, filled: Map<string, ServiceFn>): void {
  tables.set(registry, filled);
}

/** Whether a name is filled under a registry. */
export const hasService = (registry: object, name: string): boolean => tables.get(registry)?.has(name) ?? false;

/** The names filled under a registry, of one family when it is given. */
export const servicesOf = (registry: object, family?: Family): string[] =>
  [...(tables.get(registry)?.keys() ?? [])].filter((n) => !family || serviceName(n)?.family === family);

/** Call a service by its name, as whatever provides it here answers; refused when nothing does. */
export async function callService<O = unknown>(registry: object, name: string, input: unknown): Promise<O> {
  const fn = tables.get(registry)?.get(name);
  if (!fn) throw new Error(`No pack here provides service:${name}`);
  return (await fn(input)) as O;
}
