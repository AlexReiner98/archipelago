// Repositories as the software pack reads them: one found by its id, its GitHub name or its title, its last push,
// and the open work that is its: what lives in it, and all that is part of that or about it.

/** Whether an item read from the map is of a type, flavours included: every item comes with what it is. */
export const isA = (item, type) => Boolean(item?.is?.includes(type));

/**
 * "owner/name" from any way of writing a GitHub repository's address, or from the name itself. An address copied
 * from the browser on some page of the repository (.../tree/main, .../issues/3) is the repository's too.
 */
export function repoName(remote) {
  const text = String(remote ?? '').trim();
  const match = /github\.com[:/]+([^/\s]+)\/([^/\s?#]+?)(?:\.git)?(?:[/?#]\S*)?$/i.exec(text) ?? /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(text);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
}

/** A repository by its id, by its GitHub name, or by its title. Asked for none, or one that is not there, it says which there are. */
export async function findRepo(ctx, key, view) {
  const repos = (await ctx.read({ items: { type: 'software.repo' }, fields: ['remote'] })).sort((a, b) => a.title.localeCompare(b.title));
  const wanted = key?.trim().toLowerCase();
  const name = repoName(key);
  const repo = wanted && (repos.find((r) => r.id === wanted) ?? (name && repos.find((r) => repoName(r.props.remote) === name)) ?? repos.find((r) => r.title.toLowerCase() === wanted));
  if (repo) return repo;
  const known = repos.map((r) => `${r.title} (${r.id})`).join(', ') || 'none';
  throw new Error(`${key ? `No repository "${key}" in the map` : `${view} needs "repo"`}: give its id, its GitHub name ("owner/name") or its title. Repositories here: ${known}`);
}

/** Pushes to a repository's branches, as GitHub told of them, newest first: a tag, or a branch deleted, is no push of work. */
export async function pushes(ctx, repo, since, limit) {
  const heard = await ctx.read({ events: { action: 'repo.push', target: repo, ...(since && { since }), limit: limit * 3 } });
  return heard.filter((p) => (p.detail?.branch ?? '') !== '' && p.detail?.deleted == null).slice(0, limit);
}

export const lastPush = async (ctx, repo) => {
  const [p] = await pushes(ctx, repo, undefined, 1);
  return p ? { at: p.ts, branch: p.detail?.branch ?? '', head: p.detail?.after?.slice(0, 7), subject: p.reason } : null;
};

/** Open tasks, decisions and issues that are the repository's, split by whether they can run now. */
export async function repoWork(input, ctx) {
  const repo = await findRepo(ctx, input.repo, 'repo_work');
  const rows = (await ctx.read({ scope: repo.id, types: ['task', 'decision', 'issue'], open: true, fields: ['due'] }))
    .map((e) => ({ id: e.id, type: e.type, title: e.title, status: e.status, owner: e.owner, due: e.props.due ?? null, last_confirmed: e.updated_at }))
    .sort((a, b) => (a.due === b.due ? 0 : a.due === null ? 1 : b.due === null ? -1 : String(a.due).localeCompare(String(b.due))) || String(b.last_confirmed).localeCompare(String(a.last_confirmed)) || a.id.localeCompare(b.id));
  const state = rows.length ? await ctx.read({ blocked: rows.map((r) => r.id) }) : {};
  return {
    repo: { id: repo.id, title: repo.title },
    last_push: await lastPush(ctx, repo.id),
    ready: rows.filter((r) => !state[r.id].blocked),
    blocked: rows.filter((r) => state[r.id].blocked).map((r) => ({ ...r, waiting_on: state[r.id].roots.map((x) => x.title) })),
  };
}
