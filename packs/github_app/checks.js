// The check on the main branch: every commit accounted for (the owner, 26 Oct 2026). The GitHub pack in the workspace
// decides it, since it reads the map; this pack posts it on GitHub as the installation, since only it may write there.
// While a check is red it is kept here and the workspace is asked again each minute (a question, which writes and logs
// nothing there), and the check is changed on GitHub when the answer changes: it turns green by itself once the last
// commit is accounted for. GitHub's own "Re-run" asks again at once.

/** The check's name, as the GitHub pack gives it: a "Re-run" of it is this pack's to answer. */
export const CHECK = 'Every commit accounted for';
const KEY = 'checks';
/** The most red checks kept, newest kept first; and how long one is asked about. */
const MOST = 100;
const DAYS = 30;

const repoOf = (payload) => payload.repository?.full_name;

/** What GitHub is told of a check: completed, with its conclusion and what it found. */
const output = (check) => ({ status: 'completed', conclusion: check.conclusion, output: { title: check.title.slice(0, 250), summary: check.summary.slice(0, 60_000) } });

/** Post a check on a commit, as the installation; its id, or why not. */
async function post(ctx, installation, repo, check) {
  const made = await ctx.request({ host: 'api', method: 'POST', path: `/repos/${repo}/check-runs`, as: installation, body: { name: check.name, head_sha: check.head_sha, ...output(check) } });
  if (made.status >= 300) return { posted: false, reason: `GitHub answered ${made.status}${made.body?.message ? `: ${made.body.message}` : ''}: the app may lack the permission to write checks.` };
  return { posted: true, id: made.body?.id };
}

/** The red checks kept, those still worth asking about. */
async function keptChecks(ctx, now = Date.now()) {
  const all = (await ctx.store.get(KEY)) ?? [];
  return all.filter((c) => now - Date.parse(c.at) < DAYS * 86_400_000);
}

/** Keep a red check to ask about again, or let a green one go; one per repository and commit. */
async function keep(ctx, entry) {
  const others = (await keptChecks(ctx)).filter((c) => !(c.repo === entry.repo && c.sha === entry.sha));
  await ctx.store.put(KEY, (entry.conclusion === 'success' ? others : [entry, ...others]).slice(0, MOST));
}

/**
 * A check the workspace's GitHub pack answered (on a push to main, or a pull request into it): posted on GitHub, and
 * kept while it is red. What GitHub said is added to the answer.
 */
export async function postCheck(ctx, installation, payload, answer) {
  const check = answer?.check;
  const repo = repoOf(payload);
  if (!check?.head_sha || !repo) return answer;
  const posted = await post(ctx, installation, repo, check);
  if (posted.posted) await keep(ctx, { installation, repo, sha: check.head_sha, id: posted.id, conclusion: check.conclusion, title: check.title, commits: check.commits, at: new Date().toISOString() });
  return { ...answer, check: { conclusion: check.conclusion, title: check.title, ...posted } };
}

/** Ask the workspace again about one kept check, and change it on GitHub when the answer changed. */
async function askAgain(ctx, entry) {
  const answer = await ctx.act('workspace.deliver', {
    connection: entry.installation,
    event: 'repo.push',
    ask: true,
    payload: { repository: { full_name: entry.repo }, head_sha: entry.sha, commits: entry.commits },
    headers: { 'x-github-event': 'accounting' },
  });
  const check = answer?.check;
  if (!check?.conclusion) return entry;
  if (check.conclusion === entry.conclusion && check.title === entry.title) return entry;
  const made = await ctx.request({ host: 'api', method: 'PATCH', path: `/repos/${entry.repo}/check-runs/${entry.id}`, as: entry.installation, body: output(check) });
  return made.status < 300 ? { ...entry, conclusion: check.conclusion, title: check.title } : entry;
}

/** Every minute: each red check kept is asked about again; those now green are let go. */
export async function recheck(_input, ctx) {
  const checks = await keptChecks(ctx);
  const now = [];
  for (const entry of checks) now.push(await askAgain(ctx, entry).catch(() => entry));
  await ctx.store.put(KEY, now.filter((c) => c.conclusion !== 'success'));
  return { answer: { asked: checks.length, green: now.filter((c) => c.conclusion === 'success').map((c) => `${c.repo}@${c.sha.slice(0, 7)}`) } };
}

/** GitHub's "Re-run" on our check: asked again at once, if it is one kept. */
export async function rerun(ctx, payload) {
  const run = payload.check_run;
  const entry = (await keptChecks(ctx)).find((c) => c.repo === repoOf(payload) && (c.id === run?.id || c.sha === run?.head_sha));
  if (!entry) return { recorded: false, reason: 'Not a red check this app keeps: push again to check it anew.' };
  const now = await askAgain(ctx, entry);
  await keep(ctx, now);
  return { recorded: false, check: { conclusion: now.conclusion, title: now.title } };
}
