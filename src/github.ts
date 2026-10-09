// GitHub tells the map when a repository changes. A push is the moment
// reality moved, whoever did the work and whether or not an agent session was
// open, so it is what keeps the map from going stale: each push is recorded
// against its repository, and a commit that says it closes something proposes
// exactly that. Reading the commits for what else they settle is an agent's
// work, run from the repository on the same push (examples/github).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { newSecret } from './auth.ts';
import type { Entity, Lattice } from './lattice.ts';
import { notify } from './notify.ts';

/** The setting that holds a workspace's webhook secret. GitHub signs with it, so it is kept as it is, not as a hash. */
const SECRET = 'github_secret';

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
export async function repoByName(l: Lattice, name: string | undefined): Promise<Entity | undefined> {
  if (!name || !l.registry.type('software.repo')) return undefined;
  const { rows } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null and props ? 'remote'`, [l.registry.family('software.repo')]);
  return rows.find((r) => repoName(r.props.remote as string) === name.toLowerCase());
}

/** When each repository was last pushed to, as GitHub told us. */
export async function lastPushes(l: Lattice): Promise<Map<string, { at: string; branch: string; head?: string; subject: string }>> {
  const { rows } = await l.db.query<{ target_id: string; ts: string; reason: string; detail: { branch?: string; after?: string } }>(
    // A tag, or a branch that was deleted, is heard but is not a push of work to a branch.
    `select distinct on (target_id) target_id, ts, reason, detail from event
     where action = 'repo.push' and target_id is not null and coalesce(detail->>'branch', '') <> '' and detail->>'deleted' is null
     order by target_id, seq desc`,
  );
  return new Map(rows.map((r) => [r.target_id, { at: r.ts, branch: r.detail?.branch ?? '', head: r.detail?.after?.slice(0, 7), subject: r.reason }]));
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
  deleted?: boolean;
  repository?: { full_name?: string; default_branch?: string };
  pusher?: { name?: string };
  commits?: { id: string; message: string; url?: string; author?: { name?: string } }[];
}

/**
 * The payload of a delivery, in either content type a webhook can be set to:
 * JSON, or GitHub's default, a form with the JSON in its "payload" field.
 * Undefined when the body is neither.
 */
export function deliveryPayload(body: Buffer, contentType: string | undefined): PushPayload | undefined {
  const text = body.toString('utf8');
  try {
    const parsed: unknown = JSON.parse(/x-www-form-urlencoded/i.test(contentType ?? '') ? (new URLSearchParams(text).get('payload') ?? '') : text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as PushPayload) : undefined;
  } catch {
    return undefined;
  }
}

// "closes e_abc12345", "fixes e_..., e_...", "done: e_...": the commit says what it finished.
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|finish(?:e[sd])?|done)\b[:\s]+((?:e_[a-z0-9]{8}\b[\s,&]*(?:and\s+)?)+)/gi;
// "does not fix e_... yet", "only partly fixes e_...": said earlier in the same sentence, it takes the claim back.
const NEGATED = /(?:\b(?:not|never|no longer|cannot|partly|partially)\b|n't\b)[^.;\n]*$/i;

/**
 * The ids a commit message says it finished. Only what the commit says in
 * its own words counts: a revert repeats the message of the commit it
 * undoes, and quoted text is someone else's claim.
 */
export function finishedBy(message: string): string[] {
  if (/^revert\b/i.test(message) || /^This reverts commit\b/im.test(message)) return [];
  const own = message.replace(/^\s*>.*$/gm, '').replace(/"[^"\n]*"/g, '""');
  const ids: string[] = [];
  for (const match of own.matchAll(CLOSES)) {
    if (NEGATED.test(own.slice(0, match.index))) continue;
    ids.push(...(match[1].match(/e_[a-z0-9]{8}/g) ?? []));
  }
  return [...new Set(ids)];
}

/**
 * Take a push in. It is recorded against its repository whatever the branch,
 * and so is a tag, or a branch or tag being deleted, as what it is.
 * On the default branch, anything a commit message says it closes is closed
 * the way any agent would: as a change of its own, held for the human unless
 * policy lets it through. Questions are left alone: a commit cannot say what
 * was decided.
 *
 * GitHub sends a delivery again when asked to, or when it did not hear the
 * answer, under the same id (the X-GitHub-Delivery header): it is taken in
 * once. And a thing already waiting to be closed is not proposed twice.
 *
 * A push GitHub could not deliver (the server was restarting, say) is not
 * sent again unasked. It shows in the next one: that push starts from a
 * commit other than the one the last heard push ended on. The gap is
 * recorded with the push and the human is told, so the commits in it can be
 * read; it cannot be filled in from here.
 */
export async function receivePush(l: Lattice, payload: PushPayload, delivery?: string) {
  const name = payload.repository?.full_name?.toLowerCase();
  const repo = await repoByName(l, name);
  if (!repo) return { recorded: false, reason: `No repository in this map has the remote github.com/${name}. Give one that address and pushes to it will be recorded.` };
  if (delivery) {
    const { rows } = await l.db.query(`select 1 from event where action = 'repo.push' and detail->>'delivery' = $1 limit 1`, [delivery]);
    if (rows.length) return { recorded: false, reason: 'This delivery was already taken in.' };
  }
  // A repository connected twice (the app, and a webhook added by hand before it) says each push twice, under
  // two delivery ids: the commit a branch was moved to is what makes it the same push.
  if (payload.after && !payload.deleted && !/^0+$/.test(payload.after) && payload.ref?.startsWith('refs/heads/')) {
    const { rows } = await l.db.query(`select 1 from event where action = 'repo.push' and target_id = $1 and detail->>'after' = $2 and detail->>'branch' = $3 and detail->>'deleted' is null limit 1`, [repo.id, payload.after, payload.ref.slice('refs/heads/'.length)]);
    if (rows.length) return { recorded: false, reason: 'This push was already taken in: it arrived another way too.' };
  }
  const ref = payload.ref ?? '';
  const tag = ref.startsWith('refs/tags/') ? ref.slice('refs/tags/'.length) : undefined;
  const branch = tag === undefined ? ref.replace(/^refs\/heads\//, '') : undefined;
  const deleted = payload.deleted || undefined;
  const main = !deleted && branch !== undefined && branch === payload.repository?.default_branch;
  const what = tag === undefined ? `branch ${branch}` : `tag ${tag}`;
  const commits = payload.commits ?? [];
  const subject = (message: string) => message.split('\n')[0].slice(0, 200);
  const who = `github:${payload.pusher?.name ?? 'someone'}`;
  let missed: { from: string; to: string } | undefined;
  if (branch !== undefined && !deleted && payload.before && !/^0+$/.test(payload.before)) {
    const { rows } = await l.db.query<{ after: string | null }>(
      `select detail->>'after' as after from event where action = 'repo.push' and target_id = $1 and detail->>'branch' = $2 and detail->>'deleted' is null order by seq desc limit 1`,
      [repo.id, branch],
    );
    if (rows[0]?.after && rows[0].after !== payload.before) missed = { from: rows[0].after, to: payload.before };
  }
  await l.log(l.db, {
    actor: who,
    action: 'repo.push',
    target: repo.id,
    origin: 'github',
    reason: deleted ? `${what} deleted` : tag !== undefined ? `${what} pushed` : commits.length ? `${commits.length} commit${commits.length === 1 ? '' : 's'} to ${branch}: ${subject(commits.at(-1)!.message)}` : `${branch} moved`,
    detail: { repo: name, delivery, branch, tag, deleted, missed, default_branch: main, before: payload.before, after: payload.after, commits: commits.slice(-20).map((c) => ({ sha: c.id.slice(0, 7), subject: subject(c.message), url: c.url, author: c.author?.name })) },
  });

  if (missed)
    await notify(l, { kind: 'agent', name: 'github' }, {
      title: `A push to ${branch} of ${repo.title} was not heard`,
      body: `The push just recorded starts from ${missed.to.slice(0, 7)}, but the last one heard on ${branch} ended at ${missed.from.slice(0, 7)}. Whatever was pushed in between did not reach the map: nothing its commits said they finished was closed. To read them: git log ${missed.from.slice(0, 7)}..${missed.to.slice(0, 7)}`,
      level: 'warning',
      about: repo.id,
    });

  const settled: { id: string; title: string; status: string; result: string }[] = [];
  if (main) {
    const questions = new Set([...l.registry.family('decision'), ...l.registry.family('hypothesis')]);
    const seen = new Set<string>();
    for (const c of commits) {
      for (const id of finishedBy(c.message)) {
        if (seen.has(id)) continue;
        seen.add(id);
        const e = await l.entity(id);
        const status = e && l.registry.type(e.type)?.statuses.closed[0];
        if (!e || !status || !e.is_open || e.archived_at || questions.has(e.type)) continue;
        const { rows: waiting } = await l.db.query(`select 1 from proposal where status = 'pending' and ops @> $1::jsonb limit 1`, [JSON.stringify([{ op: 'update', id, status }])]);
        if (waiting.length) {
          settled.push({ id, title: e.title, status, result: 'already proposed' });
          continue;
        }
        const result = await l.change({ kind: 'agent', name: who.slice('github:'.length) + ' (github)' }, { ops: [{ op: 'update', id, status }], reason: `Commit ${c.id.slice(0, 7)} says it is finished: ${subject(c.message)}`, authority: { of: 'human', basis: `Commit ${c.id.slice(0, 7)} by ${c.author?.name ?? payload.pusher?.name ?? 'its author'} says so` }, source: { uri: c.url ?? `${name}@${c.id}`, kind: 'commit', title: subject(c.message) } });
        settled.push({ id, title: e.title, status, result: result.status });
      }
    }
  }
  return { recorded: true, repo: { id: repo.id, title: repo.title }, branch, tag, deleted, missed, commits: commits.length, settled };
}
