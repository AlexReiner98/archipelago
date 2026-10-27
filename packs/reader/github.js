// How the reader reaches the repositories it reads: through the GitHub App's API host (the github_app server pack),
// as the installation this workspace connected. The kernel makes each read with the token it trades for that
// installation; the pack sees neither. It may only read.

const VIA = { via: 'github_app', host: 'api' };

/** The installation this workspace connected, or null. */
export const connected = (ctx) => ctx.read({ connection: 'github_app' });

/** One read from GitHub's API, as the installation. */
export async function gh(ctx, path) {
  const made = await ctx.request({ ...VIA, path });
  if (made.status >= 300) throw new Error(`GitHub answered ${made.status}${made.body?.message ? `: ${made.body.message}` : ''} to GET ${path}`);
  return made.body;
}

/** The repositories the installation was given, as "owner/name". */
export async function repositories(ctx) {
  const names = [];
  for (let page = 1; page <= 10; page++) {
    const answer = await gh(ctx, `/installation/repositories?per_page=100&page=${page}`);
    names.push(...(answer.repositories ?? []).map((r) => r.full_name));
    if ((answer.repositories ?? []).length < 100) break;
  }
  return names;
}

/** The repositories of this map that the installation can read: each its name on GitHub and its item here. */
export async function readable(ctx) {
  const names = new Map((await repositories(ctx)).map((n) => [n.toLowerCase(), n]));
  const items = await ctx.read({ items: { type: 'repo' }, fields: ['remote'] });
  const out = [];
  for (const r of items) {
    const match = /github\.com[:/]+([^/\s]+\/[^/\s?#]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(String(r.props?.remote ?? ''));
    const name = match && names.get(match[1].toLowerCase());
    if (name) out.push({ name, entity: { id: r.id, title: r.title, type: r.type } });
  }
  return out;
}

/** A repository's default branch. */
export const defaultBranch = async (ctx, repo) => (await gh(ctx, `/repos/${repo.name}`)).default_branch ?? 'main';

/**
 * A path or a ref the model gave, as part of an address under the one repository. A step up ("..") would be
 * resolved by the request into another repository the installation can read, so it is refused: what the reader
 * was told to ask for comes from text it read there.
 */
export function within(path) {
  const parts = String(path ?? '').split('/');
  if (parts.some((part) => part === '.' || part === '..')) throw new Error(`"${path}" steps outside the repository: give a path inside it, without "." or ".." as a part.`);
  return parts.map(encodeURIComponent).join('/');
}

/** What to search the one repository for: a query that names where to search (repo:, org:, user:) would widen it, so those words are dropped. */
export const sought = (query) => String(query ?? '').replace(/\b(?:repo|org|user|owner)\s*:\s*\S*/gi, ' ').replace(/\s+/g, ' ').trim();

export const commitLink = (repo, sha) => `https://github.com/${repo.name}/commit/${sha}`;

/** A file of the repository at a ref, as text. */
export async function fileText(ctx, repo, path, ref) {
  const f = await gh(ctx, `/repos/${repo.name}/contents/${within(path)}?ref=${encodeURIComponent(String(ref))}`);
  if (Array.isArray(f) || f.type !== 'file') throw new Error(`${path} is not a file. Use list for a folder.`);
  return Buffer.from(f.content ?? '', 'base64').toString('utf8');
}
