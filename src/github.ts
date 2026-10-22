// What the kernel still keeps of GitHub, none of it the App's (a server pack now, packs/github_app): finding a
// repository by its address, when each was last pushed to, and the Workspace card's webhook added by hand. A push
// itself is taken in by the pack that records pushes (packs/github); reading the commits is the work of a pack that hears it.

import { hookFor } from './hooks.ts';
import { hasPackSecret, setPackSecret } from './outside.ts';
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

/** The repository in the map whose remote is this GitHub repository. */
export async function repoByName(l: Archipelago, name: string | undefined): Promise<Entity | undefined> {
  if (!name || !l.registry.type('software.repo')) return undefined;
  const { rows } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null and props ? 'remote'`, [l.registry.family('software.repo')]);
  return rows.find((r) => repoName(r.props.remote as string) === name.toLowerCase());
}

/** When each repository was last pushed to, as GitHub told us. */
export async function lastPushes(l: Archipelago): Promise<Map<string, { at: string; branch: string; head?: string; subject: string }>> {
  const { rows } = await l.db.query<{ target_id: string; ts: string; reason: string; detail: { branch?: string; after?: string } }>(
    // A tag, or a branch that was deleted, is heard but is not a push of work to a branch.
    `select distinct on (target_id) target_id, ts, reason, detail from event
     where action = 'repo.push' and target_id is not null and coalesce(detail->>'branch', '') <> '' and detail->>'deleted' is null
     order by target_id, seq desc`,
  );
  return new Map(rows.map((r) => [r.target_id, { at: r.ts, branch: r.detail?.branch ?? '', head: r.detail?.after?.slice(0, 7), subject: r.reason }]));
}

export async function githubStatus(l: Archipelago) {
  const { rows } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null order by title`, [l.registry.family('software.repo')]);
  const pushes = await lastPushes(l);
  // The webhook added by hand is the pack's: where it is served, and whether the owner has made its secret.
  const hook = hookFor(l, 'repo.push');
  return {
    connected: Boolean(hook && (await hasPackSecret(l, hook.pack, hook.secret))),
    webhook_path: hook ? `/hook/${l.workspace}/${hook.pack}/${hook.hook}` : null,
    repos: rows.map((r) => ({ id: r.id, title: r.title, github: repoName(r.props.remote as string) ?? null, last_push: pushes.get(r.id) ?? null })),
  };
}

/** Make (or replace) the secret GitHub signs its deliveries with, kept for the pack that takes them in. Returned once. */
export async function newGithubSecret(l: Archipelago): Promise<string> {
  const hook = hookFor(l, 'repo.push');
  if (!hook) throw new Error('No pack here takes pushes in: turn the GitHub pack on first.');
  return (await setPackSecret(l, { pack: hook.pack, name: hook.secret, make: true })).secret!;
}
