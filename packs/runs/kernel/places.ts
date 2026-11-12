// Where a session works. It says where as keys (the address its checkout was cloned from, the folder it runs in),
// and the kernel asks every type of place that declares where with an address or a folder which of its items those
// keys name. Which packs ship such places the kernel does not know: with none, a session is tied to no place.

import type { KernelContext } from '#pelago/kernel';

/** What reads the registry alone: a pack's context, or anything that carries a registry as it does. */
type Reg = Pick<KernelContext, 'registry'>;

/** A place as the map keeps it: the fields read here. */
export interface Place {
  id: string;
  type: string;
  title: string;
  props: Record<string, unknown>;
  [column: string]: unknown;
}

const norm = (path: string) => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();

/** The link that ties a thing to this place: of the relations that are a kind of lives_in, the nearest one its type is made for (as packreads-scope reads it). */
export function livesInFor(ctx: Reg, placeType: string): string {
  const lineage = ctx.registry.type(placeType)?.lineage ?? [placeType];
  const fits = ctx.registry
    .relationFamily('lives_in')
    .map((id) => ctx.registry.relations.get(id)!)
    .map((r) => ({ id: r.id, at: Math.min(...r.to.map((t) => (t === '*' ? lineage.length : lineage.indexOf(t))).filter((i) => i >= 0)) }))
    .filter((r) => Number.isFinite(r.at));
  return fits.sort((a, b) => a.at - b.at)[0]?.id ?? 'lives_in';
}

/** The relations a thing lives in a place by, read whichever flavour tied it. */
export const livesIn = (ctx: Reg) => ctx.registry.relationFamily('lives_in');

/** The ids of everything that is a place's or an item's: itself, what lives in it, and all part of that or about it; open: only what is open and not the system's, and the item; among: only which of these. */
export async function scopeOf(ctx: KernelContext, id: string, open = false, among?: string[]): Promise<Set<string>> {
  return new Set((await ctx.reads({ within: { id, open, ...(among && { among }) } })) as string[]);
}

/**
 * An address as one key, however it was written: https://host/owner/name, git@host:owner/name.git and
 * ssh://git@host/owner/name are all host/owner/name.
 */
export function addressKey(address: string): string {
  let a = address.trim().toLowerCase();
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//.exec(a);
  if (scheme) a = a.slice(scheme[0].length);
  a = a.replace(/^[^@/]+@/, '');
  if (!scheme) a = a.replace(/^([^/:]+):(?!\d)/, '$1/');
  return a.replace(/\/+$/, '').replace(/\.git$/, '').replace(/\/+$/, '');
}

/** Whether two addresses name one place: the same, or one is the other without its host (owner/name). */
export const sameAddress = (a: string, b: string) => {
  const [x, y] = [addressKey(a), addressKey(b)];
  return Boolean(x && y) && (x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`));
};

/** The place these keys name, if the map holds one: by its address, which is the same on every machine, or failing that by the folder that holds the one given, the nearest first. */
export async function placeFor(ctx: KernelContext, keys: { remote?: string; cwd?: string }): Promise<Place | undefined> {
  const types = [...ctx.registry.types.values()].filter((t) => t.capabilities.where?.address || t.capabilities.where?.folder);
  if (!types.length || (!keys.remote && !keys.cwd)) return undefined;
  const rows = (await ctx.reads({ places_of: types.map((t) => t.id) })) as Place[];
  const where = (e: Place) => ctx.registry.type(e.type)!.capabilities.where!;
  const field = (e: Place, name: string | undefined) => (name && typeof e.props[name] === 'string' ? (e.props[name] as string) : undefined);
  if (keys.remote) {
    const named = rows.find((e) => {
      const address = field(e, where(e).address);
      return address !== undefined && sameAddress(address, keys.remote!);
    });
    if (named) return named;
  }
  if (!keys.cwd) return undefined;
  const here = norm(keys.cwd);
  return rows
    .map((e) => ({ e, folder: field(e, where(e).folder) }))
    .filter(({ folder }) => folder && (here === norm(folder) || here.startsWith(norm(folder) + '/')))
    .sort((a, b) => b.folder!.length - a.folder!.length)[0]?.e;
}

/** What a place is known by, as its own fields give it (address, folder): undefined for anything not known by either. */
export function whereOf(ctx: Reg, e: { type: string; props: Record<string, unknown> }): { address?: string; folder?: string } | undefined {
  const where = ctx.registry.type(e.type)?.capabilities.where;
  if (!where?.address && !where?.folder) return undefined;
  const field = (name: string | undefined) => (name && typeof e.props[name] === 'string' ? (e.props[name] as string) : undefined);
  return { address: field(where.address), folder: field(where.folder) };
}
