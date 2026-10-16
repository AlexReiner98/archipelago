// What a scheduled agent should re-check in a repository, and what agents have used there.

import { GOES_STALE } from './handoff.js';
import { findRepo } from './repo.js';

/** How often a project's oldest items are re-checked when the project does not say: weekly. */
const RECHECK_DAYS = 7;
const DAY = 86_400_000;

/**
 * How often, and whether it has waited that long since the last time. A project says how often itself; a feature
 * living in a repository on its own takes the answer of the project it is part of.
 */
async function recheckOf(ctx, project, now) {
  let every = RECHECK_DAYS;
  for (let at = project, depth = 0; at && depth < 6; depth++) {
    if (typeof at.props?.recheck_days === 'number') {
      every = at.props.recheck_days;
      break;
    }
    [at] = await ctx.read({ related: at.id, relation: 'part_of', fields: ['recheck_days'] });
  }
  const last = project.props?.rechecked_at;
  // Two hours of grace, so a daily asker that comes a little early one day does not wait another.
  const waited = every > 0 && (!last || now - Date.parse(last) >= every * DAY - 7_200_000);
  return { every, last: last ?? null, waited };
}

/**
 * The open projects that live in a repository, and the features that live there on their own: a repository may hold
 * one feature of a project that lives elsewhere, and its work goes stale like any other. A feature whose project
 * lives here too is that project's, and is not listed twice.
 */
async function projectsIn(ctx, repo) {
  const living = (await ctx.read({ related: repo, relation: 'lives_in', direction: 'in', types: ['project', 'software.feature'], fields: ['recheck_days', 'rechecked_at'] })).filter((p) => p.is_open);
  const out = [];
  for (const p of living) {
    let there = false;
    for (const up of await ctx.read({ related: p.id, relation: 'part_of', fields: [] })) if ((await ctx.read({ related: up.id, relation: 'lives_in', fields: [] })).some((x) => x.id === repo)) there = true;
    if (!there) out.push(p);
  }
  return out.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}

/** A project's open items nobody has changed or confirmed for `days`, oldest first. */
async function oldest(ctx, project, days, limit, now) {
  const items = (await ctx.read({ scope: project, types: GOES_STALE, open: true, fields: [] }))
    .filter((e) => Date.parse(e.updated_at) <= now - days * DAY)
    .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)) || a.id.localeCompare(b.id))
    .slice(0, limit);
  return items.map((e) => ({ id: e.id, type: e.type, title: e.title, status: e.status, owner: e.owner, last_confirmed: e.updated_at, days: Math.floor((now - Date.parse(e.updated_at)) / DAY) }));
}

/**
 * What a scheduled agent should re-check in a repository now: for each project there that has waited as long as it
 * asks between re-checks, its open items nobody has changed or confirmed in that time, oldest first. The list is long
 * on purpose: the oldest are often chores no repository can settle, and the one re-checking has to get past them.
 * What is said to wait on a person is left out: the code cannot tell, and that has been recorded.
 */
export async function recheck(input, ctx) {
  const repo = await findRepo(ctx, input.repo, 'recheck');
  const now = Date.parse(ctx.now);
  const limit = input.limit ?? 25;
  const projects = [];
  for (const p of await projectsIn(ctx, repo.id)) {
    const { every, last, waited } = await recheckOf(ctx, p, now);
    // Asked for now, the interval and the items' age are set aside: whatever is oldest is looked at.
    const old = input.now || waited ? await oldest(ctx, p.id, input.now ? 0 : every, limit + 25, now) : [];
    const state = old.length ? await ctx.read({ blocked: old.map((i) => i.id) }) : {};
    const items = old.filter((i) => !state[i.id].waits_on_someone).slice(0, limit);
    projects.push({ id: p.id, title: p.title, every_days: every, rechecked_at: last, waited, due: items.length > 0, items });
  }
  return {
    repo: { id: repo.id, title: repo.title },
    due: projects.some((p) => p.due),
    projects,
    note: 'For each item of a project that is due: check it against the repository. If it is done or no longer as written, change it. If it is still true as written, send an update for it that changes nothing. If the repository cannot tell because it is waiting on a person to answer or act, link it to them with waits_on (what for in props.for): it is then theirs to say, and is not asked of a re-check again. When you are done, call rechecked for the repository.',
  };
}

/**
 * What agents have used in a repository: every run there that counted its tokens (a session on someone's machine,
 * the sync agent in GitHub Actions), newest first, and the sum for each place they ran over the last week and month.
 */
export async function agentUsage(input, ctx) {
  const repo = await findRepo(ctx, input.repo, 'agent_usage');
  const rows = await ctx.read({ related: repo.id, relation: 'lives_in', direction: 'in', types: ['sys.run'], newest: 'created', fields: ['tokens_used', 'surface', 'cost_usd', 'turns', 'link'] });
  const runs = rows
    .filter((e) => e.props.tokens_used != null)
    .map((e) => ({ id: e.id, title: e.title, status: e.status, surface: e.props.surface ?? 'unknown', tokens: Number(e.props.tokens_used ?? 0), cost_usd: e.props.cost_usd, turns: e.props.turns, link: e.props.link, at: e.created_at }));
  const now = Date.parse(ctx.now);
  const within = (days) => {
    const by = {};
    for (const run of runs.filter((x) => Date.parse(x.at) >= now - days * DAY)) {
      const sum = (by[run.surface] ??= { runs: 0, tokens: 0, cost_usd: 0 });
      sum.runs++;
      sum.tokens += run.tokens;
      sum.cost_usd = Math.round((sum.cost_usd + (run.cost_usd ?? 0)) * 10_000) / 10_000;
    }
    return by;
  };
  return { repo: { id: repo.id, title: repo.title }, week: within(7), month: within(30), runs: runs.slice(0, input.limit ?? 20) };
}
