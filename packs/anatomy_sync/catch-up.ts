// The catch-up: when the server starts, and every hour after, the island is brought to what main holds, whatever was
// missed. A merge to main both sends the push webhook and restarts the server, so the push's chain of requests can die
// with the old server; the catch-up that runs as the new one starts finds the island behind and finishes the work.
//
//   catch_up   the schedule: asks GitHub for main's head in each repository the island stands on
//   head       a head is in: if the island stands behind it, asks for the comparison since, and the push's chain goes
//              on from there (push.ts, compared, listed, fetched) as if the push had come
//
// Like the push, it reads the map and never writes it: the chain ends in one change the kernel applies.

import { reposOf } from './push.ts';
import { statesNow } from './states.ts';

type Ctx = { read: (q: Record<string, unknown>) => Promise<any> };
const MAIN = 'main';

/** The schedule: ask GitHub where main stands in each repository the island's sync item names. */
export async function catchUp(_input: unknown, ctx: Ctx) {
  const [sync] = await ctx.read({ items: { type: 'anatomy.sync' }, fields: ['commits'] });
  if (!sync) return { answer: { synced: false, reason: 'The island has no sync item: run scripts/anatomy.ts --full first.' } };
  const repos = reposOf(sync.props.commits);
  // Where each pack stands here, as the server starts: a change missed while it was down shows now.
  const states = await statesNow(ctx);
  return { ...(states.ops && { ops: states.ops, reason: states.reason }), requests: repos.map((r) => ({ host: 'github', path: `/repos/${r.name}/commits/${MAIN}`, then: 'anatomy_sync.head' })), answer: { synced: 'asked', repos: repos.map((r) => r.name) } };
}

/** A repository's head is in: behind it, the island asks for the comparison and the push's chain takes over. */
export async function head(input: any, ctx: Ctx) {
  if (input.status !== 200) return { answer: { synced: false, reason: `GitHub answered main's head with ${input.status}.` } };
  const name = /^\/repos\/([^/]+\/[^/]+)\/commits\//.exec(String(input.request?.path))?.[1];
  const sha = input.body?.sha;
  if (!name || typeof sha !== 'string') return { answer: { synced: false, reason: 'GitHub\'s answer named no commit.' } };
  const [sync] = await ctx.read({ items: { type: 'anatomy.sync' }, fields: ['commits'] });
  const at = reposOf(sync?.props.commits).find((r) => r.name === name);
  if (!at) return { answer: { synced: false, reason: `The island does not stand on ${name}.` } };
  if (at.sha === sha) return { answer: { synced: true, reason: `The island already stands at ${name}'s main.` } };
  return { requests: [{ host: 'github', path: `/repos/${name}/compare/${at.sha}...${sha}`, then: 'anatomy_sync.compared' }], answer: { synced: 'asked', from: at.sha, to: sha }, reason: `Pack anatomy: catching up with ${name} at ${sha.slice(0, 8)}` };
}
