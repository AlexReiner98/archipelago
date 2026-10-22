// A push, taken in. GitHub tells the map when a repository changes: a push is the moment reality moved, whoever did
// the work and whether or not an agent session was open, so it is what keeps the map from going stale. Each push is
// recorded against its repository, and a commit that says it closes something proposes exactly that, on any branch
// (the owner, 22 Oct 2026: a branch closes only what a commit names). Reading the commits for what else they settle is the reader's work, on the same push.

/**
 * "owner/name" from any way of writing a GitHub repository's address, or from the name itself. An address copied
 * from the browser on some page of the repository (.../tree/main, .../issues/3) is the repository's too.
 */
export function repoName(remote) {
  const text = (remote ?? '').trim();
  const match = /github\.com[:/]+([^/\s]+)\/([^/\s?#]+?)(?:\.git)?(?:[/?#]\S*)?$/i.exec(text) ?? /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(text);
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
}

/**
 * The payload of a delivery, in either content type a webhook can be set to: JSON (parsed by the kernel), or
 * GitHub's default, a form with the JSON in its "payload" field. Undefined when it is neither.
 */
export function deliveryPayload(payload, contentType) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) return payload;
  if (typeof payload !== 'string') return undefined;
  try {
    const parsed = JSON.parse(/x-www-form-urlencoded/i.test(contentType ?? '') ? (new URLSearchParams(payload).get('payload') ?? '') : payload);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

// "closes e_abc12345", "fixes e_..., e_...", "done: e_...": the commit says what it finished.
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|finish(?:e[sd])?|done)\b[:\s]+((?:e_[a-z0-9]{8}\b[\s,&]*(?:and\s+)?)+)/gi;
// "does not fix e_... yet", "only partly fixes e_...": said earlier in the same sentence, it takes the claim back.
const NEGATED = /(?:\b(?:not|never|no longer|cannot|partly|partially)\b|n't\b)[^.;\n]*$/i;

/**
 * The ids a commit message says it finished. Only what the commit says in its own words counts: a revert repeats
 * the message of the commit it undoes, and quoted text is someone else's claim.
 */
export function finishedBy(message) {
  if (/^revert\b/i.test(message) || /^This reverts commit\b/im.test(message)) return [];
  const own = message.replace(/^\s*>.*$/gm, '').replace(/"[^"\n]*"/g, '""');
  const ids = [];
  for (const match of own.matchAll(CLOSES)) {
    if (NEGATED.test(own.slice(0, match.index))) continue;
    ids.push(...(match[1].match(/e_[a-z0-9]{8}/g) ?? []));
  }
  return [...new Set(ids)];
}

const zero = (sha) => !sha || /^0+$/.test(sha);
const subject = (message) => message.split('\n')[0].slice(0, 200);

/**
 * Take a delivery in. A push is recorded against its repository whatever the branch, and so is a tag, or a branch
 * or tag being deleted, as what it is. On any branch, anything a commit says it closes is proposed closed, a
 * change of its own each, held for the human unless policy lets it through. Questions are left alone: a commit cannot
 * say what was decided.
 *
 * GitHub sends a delivery again when asked to, under the same id: it is taken in once. A repository connected twice
 * (the app, and a webhook added by hand) says each push twice, under two ids: the commit a branch was moved to makes
 * it the same push. And a thing already waiting to be closed is not proposed twice.
 *
 * A push GitHub could not deliver is not sent again unasked. It shows in the next one, which starts from a commit
 * other than the one the last heard push ended on: the gap is recorded with the push and the owner is told.
 */
export async function push(input, ctx) {
  const headers = input.headers ?? {};
  const event = headers['x-github-event'];
  if (event === 'ping') return { answer: { recorded: false, reason: 'pong' } };
  if (event !== undefined && event !== 'push') return { answer: { recorded: false, reason: `Only pushes are taken in, not "${event}".` } };
  const payload = deliveryPayload(input.payload, headers['content-type']);
  if (!payload) return { answer: { recorded: false, reason: 'The delivery is not JSON, nor a form with JSON in its "payload" field. Set the webhook\'s content type to application/json.' } };
  const delivery = typeof headers['x-github-delivery'] === 'string' ? headers['x-github-delivery'] : undefined;

  const name = payload.repository?.full_name?.toLowerCase();
  const repos = name ? await ctx.read({ items: { type: 'software.repo' }, fields: ['remote'] }) : [];
  const repo = repos.find((r) => repoName(r.props?.remote) === name);
  if (!repo) return { answer: { recorded: false, reason: `No repository in this map has the remote github.com/${name}. Give one that address and pushes to it will be recorded.` } };

  const heard = await ctx.read({ events: { action: 'repo.push', target: repo.id, limit: 500 } });
  if (delivery && heard.some((e) => e.detail?.delivery === delivery)) return { answer: { recorded: false, reason: 'This delivery was already taken in.' } };
  const ref = payload.ref ?? '';
  const tag = ref.startsWith('refs/tags/') ? ref.slice('refs/tags/'.length) : undefined;
  const branch = tag === undefined ? ref.replace(/^refs\/heads\//, '') : undefined;
  const deleted = payload.deleted || undefined;
  const onBranch = (e) => e.detail?.branch === branch && !e.detail?.deleted;
  if (!zero(payload.after) && !deleted && ref.startsWith('refs/heads/') && heard.some((e) => onBranch(e) && e.detail?.after === payload.after))
    return { answer: { recorded: false, reason: 'This push was already taken in: it arrived another way too.' } };

  const main = !deleted && branch !== undefined && branch === payload.repository?.default_branch;
  const what = tag === undefined ? `branch ${branch}` : `tag ${tag}`;
  const commits = payload.commits ?? [];
  const pusher = payload.pusher?.name ?? 'someone';
  // The events come newest first: the last heard push on this branch is where this one should start.
  const last = branch !== undefined && !deleted && !zero(payload.before) ? heard.find(onBranch) : undefined;
  const missed = last?.detail?.after && last.detail.after !== payload.before ? { from: last.detail.after, to: payload.before } : undefined;

  const log = [
    {
      action: 'repo.push',
      target: repo.id,
      reason: deleted ? `${what} deleted` : tag !== undefined ? `${what} pushed` : commits.length ? `${commits.length} commit${commits.length === 1 ? '' : 's'} to ${branch}: ${subject(commits.at(-1).message)}` : `${branch} moved`,
      detail: { repo: name, pusher, delivery, branch, tag, deleted, missed, default_branch: main, before: payload.before, after: payload.after, commits: commits.slice(-20).map((c) => ({ sha: c.id.slice(0, 7), subject: subject(c.message), url: c.url, author: c.author?.name })) },
    },
  ];
  const notify = missed
    ? [
        {
          title: `A push to ${branch} of ${repo.title} was not heard`,
          body: `The push just recorded starts from ${missed.to.slice(0, 7)}, but the last one heard on ${branch} ended at ${missed.from.slice(0, 7)}. Whatever was pushed in between did not reach the map: nothing its commits said they finished was closed. To read them: git log ${missed.from.slice(0, 7)}..${missed.to.slice(0, 7)}`,
          level: 'warning',
          about: repo.id,
        },
      ]
    : [];

  const changes = [];
  const settled = [];
  if (!deleted && branch !== undefined) {
    const seen = new Set();
    for (const c of commits) {
      for (const id of finishedBy(c.message)) {
        if (seen.has(id)) continue;
        seen.add(id);
        const e = await ctx.read({ get: id });
        const type = e && (await ctx.read({ type_info: e.type }));
        const status = type?.statuses.closed[0];
        if (!e || !status || !e.is_open || e.archived_at || type.settles) continue;
        if (await ctx.read({ proposed: { op: 'update', id, status } })) {
          settled.push({ id, title: e.title, status, result: 'already proposed' });
          continue;
        }
        changes.push({
          ops: [{ op: 'update', id, status }],
          reason: `Commit ${c.id.slice(0, 7)} says it is finished: ${subject(c.message)}`,
          authority: { of: 'human', basis: `Commit ${c.id.slice(0, 7)} by ${c.author?.name ?? pusher} says so` },
          source: { uri: c.url ?? `${name}@${c.id}`, kind: 'commit', title: subject(c.message) },
        });
        settled.push({ id, title: e.title, status, result: 'proposed' });
      }
    }
  }
  return { log, notify, changes, answer: { recorded: true, repo: { id: repo.id, title: repo.title }, branch, tag, deleted, missed, commits: commits.length, settled } };
}
