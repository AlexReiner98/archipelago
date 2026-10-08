// GitHub tells the map when a repository changes. A push is the moment
// reality moved, whoever did the work and whether or not an agent session was
// open, so it is what keeps the map from going stale: each push is recorded
// against its repository, and a commit that says it closes something proposes
// exactly that. Reading the commits for what else they settle is an agent's
// work, run from the repository on the same push (examples/github).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { newSecret } from './auth.ts';
import type { Entity, Lattice } from './lattice.ts';

/** The setting that holds a workspace's webhook secret. GitHub signs with it, so it is kept as it is, not as a hash. */
const SECRET = 'github_secret';

/** "owner/name" from any way of writing a GitHub repository's address, or from the name itself. */
export function repoName(remote: string | undefined): string | undefined {
  const text = (remote ?? '').trim();
  const match = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(text) ?? /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(text);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
}

/** The repository in the map whose remote is this GitHub repository. */
export async function repoByName(l: Lattice, name: string | undefined): Promise<Entity | undefined> {
  if (!name || !l.registry.type('software.repo')) return undefined;
  const { rows } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null and props ? 'remote'`, [l.registry.family('software.repo')]);
  return rows.find((r) => repoName(r.props.remote as string) === name.toLowerCase());
}

/** When each repository was last pushed to, as GitHub told us. */
export async function lastPushes(l: Lattice): Promise<Map<string, { at: string; branch: string; subject: string }>> {
  const { rows } = await l.db.query<{ target_id: string; ts: string; reason: string; detail: { branch?: string } }>(
    `select distinct on (target_id) target_id, ts, reason, detail from event where action = 'repo.push' and target_id is not null order by target_id, seq desc`,
  );
  return new Map(rows.map((r) => [r.target_id, { at: r.ts, branch: r.detail?.branch ?? '', subject: r.reason }]));
}

export async function githubStatus(l: Lattice) {
  const { rows } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null order by title`, [l.registry.family('software.repo')]);
  const pushes = await lastPushes(l);
  return {
    connected: Boolean(await l.setting<string>(SECRET)),
    webhook_path: `/github/${l.workspace}`,
    repos: rows.map((r) => ({ id: r.id, title: r.title, github: repoName(r.props.remote as string) ?? null, last_push: pushes.get(r.id) ?? null })),
  };
}

/** Make (or replace) the secret GitHub signs its deliveries with. Returned once. */
export async function newGithubSecret(l: Lattice): Promise<string> {
  const secret = newSecret('latgh');
  await l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [SECRET, JSON.stringify(secret)]);
  return secret;
}

/** Whether a delivery was signed with this workspace's secret (the X-Hub-Signature-256 header). */
export async function signedByGithub(l: Lattice, body: Buffer, header: string | string[] | undefined): Promise<boolean> {
  const secret = await l.setting<string>(SECRET);
  if (!secret || typeof header !== 'string') return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(body).digest('hex')}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

interface PushPayload {
  ref?: string;
  before?: string;
  after?: string;
  repository?: { full_name?: string; default_branch?: string };
  pusher?: { name?: string };
  commits?: { id: string; message: string; url?: string; author?: { name?: string } }[];
}

// "closes e_abc12345", "fixes e_..., e_...", "done: e_...": the commit says what it finished.
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|finish(?:e[sd])?|done)\b[:\s]+((?:e_[a-z0-9]{8}\b[\s,&]*(?:and\s+)?)+)/gi;

/**
 * Take a push in. It is recorded against its repository whatever the branch.
 * On the default branch, anything a commit message says it closes is closed
 * the way any agent would: as a change of its own, held for the human unless
 * policy lets it through. Questions are left alone: a commit cannot say what
 * was decided.
 */
export async function receivePush(l: Lattice, payload: PushPayload) {
  const name = payload.repository?.full_name?.toLowerCase();
  const repo = await repoByName(l, name);
  if (!repo) return { recorded: false, reason: `No repository in this map has the remote github.com/${name}. Give one that address and pushes to it will be recorded.` };
  const branch = (payload.ref ?? '').replace(/^refs\/heads\//, '');
  const main = branch === payload.repository?.default_branch;
  const commits = payload.commits ?? [];
  const subject = (message: string) => message.split('\n')[0].slice(0, 200);
  const who = `github:${payload.pusher?.name ?? 'someone'}`;
  await l.log(l.db, {
    actor: who,
    action: 'repo.push',
    target: repo.id,
    origin: 'github',
    reason: commits.length ? `${commits.length} commit${commits.length === 1 ? '' : 's'} to ${branch}: ${subject(commits.at(-1)!.message)}` : `${branch} moved`,
    detail: { repo: name, branch, default_branch: main, before: payload.before, after: payload.after, commits: commits.slice(-20).map((c) => ({ sha: c.id.slice(0, 7), subject: subject(c.message), url: c.url, author: c.author?.name })) },
  });

  const settled: { id: string; title: string; status: string; result: string }[] = [];
  if (main) {
    const questions = new Set([...l.registry.family('decision'), ...l.registry.family('hypothesis')]);
    const seen = new Set<string>();
    for (const c of commits) {
      for (const match of c.message.matchAll(CLOSES)) {
        for (const id of match[1].match(/e_[a-z0-9]{8}/g) ?? []) {
          if (seen.has(id)) continue;
          seen.add(id);
          const e = await l.entity(id);
          const status = e && l.registry.type(e.type)?.statuses.closed[0];
          if (!e || !status || !e.is_open || e.archived_at || questions.has(e.type)) continue;
          const result = await l.change({ kind: 'agent', name: who.slice('github:'.length) + ' (github)' }, { ops: [{ op: 'update', id, status }], reason: `Commit ${c.id.slice(0, 7)} says it is finished: ${subject(c.message)}`, source: { uri: c.url ?? `${name}@${c.id}`, kind: 'commit', title: subject(c.message) } });
          settled.push({ id, title: e.title, status, result: result.status });
        }
      }
    }
  }
  return { recorded: true, repo: { id: repo.id, title: repo.title }, branch, commits: commits.length, settled };
}
