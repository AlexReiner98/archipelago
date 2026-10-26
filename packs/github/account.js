// Every commit accounted for before main (the owner, 26 Oct 2026). A commit is accounted for once the map holds a
// commit item for it (software.commit, by its sha): made by its session or by a person, it names the items the commit
// settles by settles links, and none when it has none. The check on the main branch is this pack's answer: green when
// every commit in a push to main, or in a pull request into it, is accounted for, red until then. The GitHub App posts
// it, and asks again while it is red, so it turns green by itself once the last commit is accounted for.

/** The check's name on GitHub. */
export const CHECK = 'Every commit accounted for';
/** The most commits one check reads: a pull request's list stops at 250 on GitHub too. */
const MOST = 250;
const RUN = /^Archipelago-Run:[ \t]*([\w-]+)[ \t]*$/im;

const subject = (message) => (message ?? '').split('\n')[0].slice(0, 120);

/** The run a commit names (the trailer the setup's commit-msg hook adds), if it names one. */
export const runOf = (message) => RUN.exec(message ?? '')?.[1];

/** What a check needs of a commit, and keeps to ask again: its sha, and its message cut to its subject and run. */
export function kept(commit) {
  const run = runOf(commit.message);
  return { id: commit.id, message: `${subject(commit.message)}${run ? `\n\nArchipelago-Run: ${run}` : ''}` };
}

/** The commits a check reads from what GitHub sent: a push's own list, or another API's (sha, commit.message). */
export const commitsOf = (list) => (list ?? []).map((c) => ({ id: c.id ?? c.sha, message: c.message ?? c.commit?.message ?? '' })).filter((c) => /^[0-9a-f]{40}$/.test(c.id ?? ''));

/** A GET through the GitHub App, as this workspace's installation; undefined when it is not connected or fails. */
async function viaApp(ctx, path) {
  try {
    const made = await ctx.read({ request: { via: 'github_app', host: 'api', path } });
    return made && made.status < 300 ? made.body : undefined;
  } catch {
    return undefined;
  }
}

/** A push's commits: GitHub lists only the last 20 in the delivery, so a longer push is asked of it whole. */
export async function pushCommits(ctx, repo, payload) {
  const listed = commitsOf(payload.commits);
  if (listed.length < 20 || /^0+$/.test(payload.before ?? '0')) return { commits: listed, whole: listed.length < 20 };
  const compared = await viaApp(ctx, `/repos/${repo}/compare/${payload.before}...${payload.after}`);
  const all = commitsOf(compared?.commits);
  return all.length ? { commits: all, whole: all.length === (compared.total_commits ?? all.length) } : { commits: listed, whole: false };
}

/** A pull request's commits, asked of GitHub, oldest first. */
export async function pullCommits(ctx, repo, number) {
  const all = [];
  for (let page = 1; page <= MOST / 100 + 1; page++) {
    const got = await viaApp(ctx, `/repos/${repo}/pulls/${number}/commits?per_page=100&page=${page}`);
    if (!Array.isArray(got)) return all.length ? { commits: all, whole: false } : undefined;
    all.push(...commitsOf(got));
    if (got.length < 100) break;
  }
  return { commits: all.slice(0, MOST), whole: all.length <= MOST };
}

/**
 * The check on these commits: each is read for its commit item, and the answer says which are accounted for and how
 * to account for the rest. `whole` false says GitHub did not give every commit, and the check says so.
 */
export async function account(ctx, head, commits, whole = true) {
  const read = [];
  for (const c of commits.slice(0, MOST)) {
    // One heard only from a push (accounted false, heard.js) accounts for nothing yet.
    const found = (await ctx.read({ items: { type: 'software.commit', where: { sha: c.id } }, fields: ['sha', 'accounted'] })).filter((e) => e.props?.accounted !== false);
    read.push({ sha: c.id, subject: subject(c.message), run: runOf(c.message), accounted: found.length > 0 ? found[0].id : null });
  }
  const open = read.filter((c) => !c.accounted);
  const n = read.length;
  const title = !n ? 'No commits to account for' : open.length ? `${open.length} of ${n} commit${n === 1 ? '' : 's'} not accounted for` : `All ${n === 1 ? 'one commit' : `${n} commits`} accounted for`;
  const lines = open.slice(0, 50).map((c) => `- \`${c.sha.slice(0, 7)}\` ${c.subject.replace(/[`*_[\]]/g, '')}${c.run ? ` (run ${c.run})` : ''}`);
  const how = [
    'A commit is accounted for once the map holds a commit item for it: type `software.commit`, its full sha in `sha`, with a `software.settles` link to each item it settles, and none when it settles nothing. Where one heard from a push is there already (`accounted` false), set `accounted` true with its links.',
    'Its session makes it with `change`; a person can on the map. This check turns green by itself once the last one is made.',
  ];
  const summary = [
    ...(open.length ? ['Not accounted for yet:', ...lines, ...(open.length > 50 ? [`- and ${open.length - 50} more`] : []), '', ...how] : [`Every commit names the items it settles, or says it settles none.`]),
    ...(whole ? [] : ['', `GitHub gave only ${n} of the commits: those are what was read.`]),
  ].join('\n');
  return { name: CHECK, head_sha: head, conclusion: open.length ? 'failure' : 'success', title, summary, commits: commits.slice(0, MOST).map(kept), open: open.map(({ sha, subject: s, run }) => ({ sha, subject: s, ...(run && { run }) })) };
}
