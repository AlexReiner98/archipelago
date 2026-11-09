// Finding a repository on the map by its GitHub address, however the address is written. Nothing here hears GitHub
// any more: the GitHub pack and the GitHub App went on 9 Nov 2026.

import type { Entity, Archipelago } from './pelago.ts';

/**
 * "owner/name" from any way of writing a GitHub repository's address, or from
 * the name itself. An address copied from the browser on some page of the
 * repository (.../tree/main, .../issues/3) is the repository's too.
 */
export function repoName(remote: string | undefined): string | undefined {
  const text = (remote ?? '').trim();
  const match = /github\.com[:/]+([^/\s]+)\/([^/\s?#]+?)(?:\.git)?(?:[/?#]\S*)?$/i.exec(text) ?? /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(text);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
}

/** The places a repository can be: every type of place known by an address (src/places.ts), and the address of one. */
const addressed = (l: Archipelago) => l.registry.having('where').filter((t) => l.registry.type(t)!.capabilities.where!.address);
const addressOf = (l: Archipelago, e: Entity) => e.props[l.registry.type(e.type)!.capabilities.where!.address!] as string | undefined;

/** The repository in the map whose address is this GitHub repository. */
export async function repoByName(l: Archipelago, name: string | undefined): Promise<Entity | undefined> {
  const types = addressed(l);
  if (!name || !types.length) return undefined;
  const { rows } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null`, [types]);
  return rows.find((r) => repoName(addressOf(l, r)) === name.toLowerCase());
}
