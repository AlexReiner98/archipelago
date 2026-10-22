// What the reader has read before, so it reads nothing twice and does not feed on its own guesses: the commits a
// finished run already read (one commit reaches a branch, the merge branch and then the default branch, under three
// pushes), and the items it made itself that nobody has looked at since.

import { commitLink } from './github.js';

/** Who the reader's runs are: the kernel names a pack's runs agent:<pack>. */
export const READER = 'agent:reader';
/** A merge commit says nothing of its own: what it brings in is in the commits it merges. */
const MERGE = /^Merge (?:pull request|branch|remote-tracking branch)\b/;

const short = (sha) => String(sha ?? '').slice(0, 7);

/** The commits (by their first seven characters) of every push to this repository whose reading finished. */
export async function readCommits(ctx, repo) {
  const runs = await ctx.read({ related: repo.entity.id, relation: 'lives_in', direction: 'in', types: ['sys.run'], newest: 'created', fields: ['link'] });
  const read = new Set(runs.filter((r) => r.status === 'finished').map((r) => r.props?.link).filter(Boolean));
  const pushes = await ctx.read({ events: { action: 'repo.push', target: repo.entity.id, limit: 300 } });
  const commits = new Set();
  for (const e of pushes) if (e.detail?.after && read.has(commitLink(repo, e.detail.after))) for (const c of e.detail.commits ?? []) commits.add(short(c.sha));
  return commits;
}

/** Of a push's commits, those still to read: not read before, and not a merge. */
export const unread = (commits, read) => (commits ?? []).filter((c) => !read.has(short(c.sha ?? c.id)) && !MERGE.test(String(c.subject ?? c.message ?? c.commit?.message ?? '')));

/** Of these items, those the reader made itself and nobody has approved or changed since: its own guesses. */
export async function ownGuesses(ctx, ids) {
  const own = [];
  for (const id of ids) {
    const [made] = await ctx.read({ events: { action: 'entity.create', target: id, limit: 1 } });
    if (made?.actor !== READER || made.detail?.approved_by) continue;
    const since = await ctx.read({ events: { action: 'entity.update', target: id, limit: 20 } });
    if (!since.some((e) => e.actor !== READER || e.detail?.approved_by)) own.push(id);
  }
  return own;
}

const words = (title) => String(title ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Whether two titles name the same thing, near enough: the same words, or nearly all of them. */
export function alike(a, b) {
  const [x, y] = [words(a), words(b)];
  if (!x || !y) return false;
  if (x === y) return true;
  const [s, t] = [new Set(x.split(' ')), new Set(y.split(' '))];
  const shared = [...s].filter((w) => t.has(w)).length;
  return shared / new Set([...s, ...t]).size >= 0.75;
}
