// The push reader: an agent on the server that keeps a workspace's map true to the repositories it connected through
// the GitHub App. When the GitHub pack records a push it reads the new commits against the repository's open items and
// sends what they change; when a re-check is due it checks the oldest open items against the code. It has no
// checkout: it reads through the App (which may only read), and never writes or calls out. It asks the kernel for a
// model run, which the kernel makes on the workspace's model account, as the agent "reader", held to the one
// repository, and answers the run's tools here.

import { connected, defaultBranch, readable, commitLink } from './github.js';
import { ownGuesses, readCommits, unread } from './history.js';
import { openWork, pushRun, pushTool, readablePush } from './push.js';
import { recheckRun, repoTool } from './recheck.js';

/** How far back the pushes read on catching up go. */
const CATCH_UP_MINUTES = 180;

/**
 * What the reader has seen of a repository: the commits a finished reading covered, and of its open work, the items
 * the reader made itself that nobody has reviewed.
 */
async function seen(ctx, repo) {
  const own = await ownGuesses(ctx, (await openWork(ctx, repo)).map((i) => i.id));
  return { read: await readCommits(ctx, repo), own };
}

/**
 * A push the GitHub pack recorded: commits to a branch of a repository the App can read are read against the map,
 * unless each was read already on another branch (a pull request's branch, then the merge to the default).
 */
async function heard(input, ctx) {
  const push = readablePush(input.event);
  if (!push || !(await connected(ctx))) return {};
  const repo = (await readable(ctx)).find((r) => r.entity.id === input.event.target);
  if (!repo) return {};
  const known = await seen(ctx, repo);
  if (!unread(input.event.detail.commits, known.read).length) return { answer: { reason: 'Every commit of this push was read already.' } };
  return { runs: [await pushRun(ctx, repo, { ...push, default_branch: await defaultBranch(ctx, repo) }, known)] };
}

/**
 * Read the pushes that were recorded and never read: a run is cut off when the server stops (a deploy of Archipelago
 * itself follows every push to its own repository by half a minute), and a run that never ended left no record. For
 * each branch pushed to lately, everything since the last push that was read is read as one, up to the newest. A
 * push whose run ended, well or badly, is not read again.
 */
async function catchUp(_input, ctx) {
  if (!(await connected(ctx))) return {};
  const since = new Date(Date.parse(ctx.now) - CATCH_UP_MINUTES * 60_000).toISOString();
  const runs = [];
  for (const repo of await readable(ctx)) {
    let known;
    const rows = (await ctx.read({ events: { action: 'repo.push', target: repo.entity.id, since, limit: 40 } })).filter((e) => e.detail?.branch && !e.detail.deleted && e.detail.after);
    let fallback;
    for (const branch of [...new Set(rows.map((r) => r.detail.branch))]) {
      // Newest first on this branch, back to the last one that was read.
      const pending = [];
      for (const { detail } of rows.filter((r) => r.detail.branch === branch)) {
        if ((await ctx.read({ items: { type: 'run', where: { link: commitLink(repo, detail.after) } }, fields: ['link'] })).length) break;
        pending.push(detail);
      }
      if (!pending.some((p) => p.commits?.length)) continue;
      known ??= await seen(ctx, repo);
      if (!unread(pending.flatMap((p) => p.commits ?? []), known.read).length) continue;
      fallback ??= await defaultBranch(ctx, repo);
      runs.push(await pushRun(ctx, repo, { branch, default_branch: fallback, before: pending.at(-1).before ?? '0', after: pending[0].after }, known));
    }
  }
  return { runs, answer: runs.map((r) => r.title) };
}

/**
 * Every hour each repository the App can read is asked whether a re-check is due (each project says how often); an
 * hour when nothing is due costs no run. Asked that often because a server that is deployed daily never sees a day.
 */
async function recheckDue(_input, ctx) {
  if (!(await connected(ctx))) return {};
  const runs = [];
  for (const repo of await readable(ctx)) {
    const run = await recheckRun(ctx, repo, await defaultBranch(ctx, repo));
    if (run) runs.push(run);
  }
  return { runs };
}

/** A re-check of one repository asked for now, by its admin. */
async function recheckNow(input, ctx) {
  if (!(await connected(ctx))) throw new Error('This workspace has not connected GitHub, so there is nothing for the agent to read the repository through.');
  const repo = (await readable(ctx)).find((r) => r.entity.id === input.repo);
  if (!repo) throw new Error('That is not a repository the GitHub App was given. Choose it on GitHub first (Workspace, Connections).');
  const run = await recheckRun(ctx, repo, await defaultBranch(ctx, repo), true);
  return run ? { runs: [run], answer: { repo: repo.name } } : { answer: { repo: repo.name, reason: 'Nothing is due for a re-check.' } };
}

/** One of a run's tools, as the model called it. */
function tool({ name, input, context }, ctx) {
  return context?.kind === 'push' ? pushTool(ctx, name, input ?? {}, context) : repoTool(ctx, name, input ?? {}, context);
}

/** A re-check is over: the wait starts again whether or not it got as far as saying so, so one that broke is not tried every hour. */
function rechecked({ ok, context }) {
  return { calls: [{ tool: 'rechecked', input: { repo: context.repo.entity.id, ...(!ok && { summary: 'The re-check did not finish.' }) } }] };
}

export default {
  'repo.push': heard,
  catch_up: catchUp,
  recheck: recheckDue,
  'reader.recheck': recheckNow,
  tool,
  rechecked,
};
