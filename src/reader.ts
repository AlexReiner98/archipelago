// The reader: an agent on this server that keeps a workspace's map true to
// the repositories it connected through the GitHub App. When a push arrives
// it reads the new commits against the repository's open items and sends
// what they change; when a re-check is due it checks the oldest open items
// against the code. It is what the workflow in a repository's Actions did,
// with nothing to set up in the repository: it has no checkout, and reads
// through the app (which may only read).
//
// It runs on the workspace's own Anthropic key, set by its admin, or on the
// model server the server is given (src/model.ts), and says what each run used
// as a run in the repository, like any other agent.

import { z } from 'zod';
import { env } from './env.ts';
import type { GithubApp } from './github-app.ts';
import { asker, configured, keyTaken, ModelError, provider, type Ask, type Tool, type ToolResultBlock, type ToolUseBlock, type Turn } from './model.ts';
import type { Actor, Entity, Archipelago } from './pelago.ts';
import { recordRun } from './sessions.ts';
import { callTool, TOOLS } from './tools.ts';

let asking: (key: string | undefined) => Ask = (key) => asker(key);
let taken: (key: string) => Promise<boolean | undefined> = (key) => keyTaken(key);
export function configureReader(make: ((key: string | undefined) => Ask) | undefined, check: (key: string) => Promise<boolean | undefined> = async () => true): void {
  if (!make) return;
  asking = make;
  taken = check;
}

/** The setting that holds a workspace's Anthropic key: sealed, since it has to be sent with every request and so cannot be kept as a hash. */
const KEY = 'anthropic_key';
export const READER_MODEL = env('READER_MODEL') || 'claude-sonnet-5-5';
/** Dollars for a million tokens of the model above: what a run is said to have cost. */
const PRICE = { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 };
/** A run stops when it has taken this many turns or used this many tokens (not counting cached re-reads). */
const MAX_TURNS = 40;
const MAX_TOKENS_USED = 600_000;
/** The most of one tool's answer that is handed back: a whole file or diff can be far more than is needed. */
const MAX_RESULT = 60_000;

/** Whether a workspace's pushes can be read: on its own key, or on the model server's when the server has one. */
export async function hasReaderKey(l: Archipelago): Promise<boolean> {
  const at = configured();
  return Boolean((at.url && at.key) || (await l.secret(KEY)));
}

/**
 * Set, or with nothing clear, the key runs are paid for with. It is never read
 * back out. A key Anthropic will not take is refused here, when it is given,
 * and not found out by the first push that goes unread.
 */
export async function setReaderKey(l: Archipelago, key: string | undefined): Promise<{ checked: boolean }> {
  const given = key?.trim();
  if (given) {
    if (/^sk-ant-oat/.test(given)) throw new Error('That is a Claude sign-in token (it starts sk-ant-oat), which signs a person in to Claude Code. The server needs an API key: make one at console.anthropic.com, under API keys.');
    const ok = await taken(given);
    if (ok === false) throw new Error(`${provider()} refused that key, so it was not saved. Check that it was copied whole and has not been revoked, or make a new one at console.anthropic.com, under API keys.`);
    await l.setSecret(KEY, given);
    return { checked: ok === true };
  }
  await l.setSecret(KEY, undefined);
  return { checked: false };
}

interface Repo {
  installation: string;
  /** "owner/name" on GitHub. */
  name: string;
  entity: { id: string; title: string };
}

/**
 * A path or a ref the model gave, as part of an address under the one repository. A step up ("..") would be
 * resolved by the request into another repository the installation can read, so it is refused: what the reader
 * was told to ask for comes from text it read there.
 */
export function within(path: unknown): string {
  const parts = String(path ?? '').split('/');
  if (parts.some((part) => part === '.' || part === '..')) throw new Error(`"${path}" steps outside the repository: give a path inside it, without "." or ".." as a part.`);
  return parts.map(encodeURIComponent).join('/');
}

/** What to search the one repository for: a query that names where to search (repo:, org:, user:) would widen it, so those words are dropped. */
export const sought = (query: unknown): string => String(query ?? '').replace(/\b(?:repo|org|user|owner)\s*:\s*\S*/gi, ' ').replace(/\s+/g, ' ').trim();

const PELAGO_TOOLS = ['view', 'search', 'get', 'events', 'schema', 'proposals', 'change', 'notify', 'rechecked'];

/** What the reader can do: the map's own tools, and reading the one repository through the app. */
function tools(app: GithubApp, repo: Repo, ref: string): { defs: Tool[]; run: (l: Archipelago, actor: Actor, name: string, input: Record<string, unknown>) => Promise<unknown> } {
  const defs: Tool[] = PELAGO_TOOLS.map((name) => {
    const { $schema: _, ...schema } = z.toJSONSchema(z.object(TOOLS[name].input)) as Record<string, unknown>;
    return { name, description: TOOLS[name].description, input_schema: schema };
  });
  const text = { type: 'string' } as const;
  const hub = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => defs.push({ name, description, input_schema: { type: 'object', properties, required } });
  hub('commits', `The commits between two points in ${repo.name}, oldest first, each with its message and the files it changed. Give base and head as commit ids or branch names.`, { base: text, head: text }, ['base', 'head']);
  hub('diff', 'One commit in full: its message and what it changed in each file.', { sha: text }, ['sha']);
  hub('file', `A file's contents in ${repo.name}. ref is a commit id or branch (left out: ${ref}).`, { path: text, ref: text }, ['path']);
  hub('list', 'What is in a folder of the repository (left out: its top). ref as for file.', { path: text, ref: text });
  hub('log', 'The latest commits, newest first, each with its date and the first line of its message. path limits it to commits that touched a file or folder; limit is how many (30 when left out, 100 at most).', { path: text, limit: { type: 'number' } });
  hub('find', 'Search the repository’s code on its default branch for words or an exact phrase. Answers with the files that match and the lines around each match.', { query: text }, ['query']);

  const at = (path: string) => app.asInstallation(repo.installation, `/repos/${repo.name}${path}`);
  const enc = within;
  const changed = (files: { filename: string; status: string; additions: number; deletions: number; patch?: string }[] | undefined, patches: boolean) =>
    (files ?? []).map((f) => ({ file: f.filename, status: f.status, added: f.additions, removed: f.deletions, ...(patches && { patch: f.patch ?? '(no text diff: binary or too large)' }) }));
  const hubTools: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {
    commits: async ({ base, head }) => {
      const c = (await at(`/compare/${enc(base)}...${enc(head)}?per_page=100`)) as { commits: { sha: string; commit: { message: string; author?: { name?: string; date?: string } } }[]; files?: Parameters<typeof changed>[0] };
      return { commits: c.commits.map((x) => ({ sha: x.sha.slice(0, 10), by: x.commit.author?.name, at: x.commit.author?.date, message: x.commit.message })), files: changed(c.files, false) };
    },
    diff: async ({ sha }) => {
      const c = (await at(`/commits/${enc(sha)}`)) as { sha: string; commit: { message: string }; files?: Parameters<typeof changed>[0] };
      return { sha: c.sha, message: c.commit.message, files: changed(c.files, true) };
    },
    file: async ({ path, ref: given }) => {
      const f = (await at(`/contents/${enc(path)}?ref=${encodeURIComponent(String(given ?? ref))}`)) as { type?: string; content?: string; size?: number };
      if (Array.isArray(f) || f.type !== 'file') throw new Error(`${path} is not a file. Use list for a folder.`);
      return Buffer.from(f.content ?? '', 'base64').toString('utf8');
    },
    list: async ({ path, ref: given }) => {
      const entries = (await at(`/contents/${enc(path)}?ref=${encodeURIComponent(String(given ?? ref))}`)) as { name: string; type: string; size: number }[];
      if (!Array.isArray(entries)) throw new Error(`${path} is a file. Use file to read it.`);
      return entries.map((e) => (e.type === 'dir' ? `${e.name}/` : `${e.name} (${e.size} bytes)`));
    },
    log: async ({ path, limit }) => {
      const n = Math.min(Math.max(Number(limit) || 30, 1), 100);
      const list = (await at(`/commits?per_page=${n}${path ? `&path=${encodeURIComponent(String(path))}` : ''}`)) as { sha: string; commit: { message: string; author?: { date?: string } } }[];
      return list.map((c) => `${c.sha.slice(0, 10)} ${c.commit.author?.date?.slice(0, 10) ?? ''} ${c.commit.message.split('\n')[0]}`);
    },
    find: async ({ query }) => {
      const found = (await app.asInstallation(repo.installation, `/search/code?per_page=20&q=${encodeURIComponent(`${sought(query)} repo:${repo.name}`)}`)) as { items?: { path: string }[] };
      return (found.items ?? []).map((i) => i.path);
    },
  };
  return {
    defs,
    run: (l, actor, name, input) => (hubTools[name] ? hubTools[name](input) : PELAGO_TOOLS.includes(name) ? callTool(l, actor, name, input) : Promise.reject(new Error(`No tool "${name}".`))),
  };
}

const ABOUT = `Archipelago is the owner's map of work: projects, features, tasks, issues, decisions. You keep it true to one
repository. You reach the map through its own tools (view, search, get, events, schema, proposals, change, notify)
and the repository through commits, diff, file, list, log and find. You cannot change the repository, only read it.
Depending on the workspace, what you send to the map is held for the owner or takes effect at once, so send only
what the repository shows.

Rules for everything you send:
- \`get\` an item before you change it, and call \`schema\` once: every type has its own statuses, and you must use the
  ones the item's type has (a task is done, a feature is built and later shipped, an issue is resolved).
- Every \`change\` carries \`authority\`: {"of": "agent", "basis": "<what in the repository shows it>"}. It is your
  reading, not the owner's word, so never "human".
- A title is a name of a few words, 60 characters at most. The rest goes in the note.
- Do not guess. A wrong change is worse than none.`;

const ON_PUSH = `${ABOUT}

A push has just landed. Your one job is to make the map true again for this repository.

1. Read what changed: \`commits\` over the range you are given, and \`diff\` for the commits that matter.
2. Read what the map believes: \`view\` with name "repo_work" and the repository as params.repo; \`search\` for anything
   else these commits touch.
3. Archipelago itself has already read this push: where a commit on the default branch says "fixes", "closes" or
   "resolves" with an item's id (e_ and eight characters), that item has been closed, or a change closing it is held
   (\`proposals\` lists what is held). Do not send those again. If \`get\` shows an item already in the state you would
   give it, leave it.
4. For each open item these commits settle or change, send one \`change\` of its own, with a reason that says what the
   commit did and the commit as the source (uri https://github.com/<repository>/commit/<sha>, kind "commit"):
   - work that is now finished: the closing status of its type;
   - work that has visibly started: the status of its type that says so;
   - a decision or hypothesis the code has in practice settled: its closing status, with props.outcome (what was
     chosen) and props.rationale (why) for a decision. Only when the commits leave no doubt; a choice that is still
     the owner's stays open, with a note if useful;
   - a title or note the commits have made wrong: the correction.
   On any branch other than the default, work is in progress, not finished: never close something because of a
   commit that is not on the default branch.
5. If the commits show work the map does not know (a follow-up named in a message, a TODO that was added, a feature
   that appeared), create it, as part of the feature or project it belongs to. Search first so you do not make a
   duplicate.
6. If nothing in the map is touched by these commits, change nothing.

Finish with two or three lines saying what you sent, or that nothing needed changing.`;

const ON_RECHECK = `${ABOUT}

This is the scheduled re-check of the map for this repository. You are given, as JSON, the projects here that are
due, each with its open items nobody has changed or confirmed for longest, oldest first. An item that old may no
longer be true. Your one job is to find out, from what is in the repository, and say so in the map.

The list is longer than you can check in one run, and many of the oldest will be things no repository can settle (a
message to send, a question to ask someone, a choice that is the owner's). Read the titles first and take the ones
the code, the tests or the history could settle, oldest first, as many as you can do properly.

For each item you take, look for the truth of it (\`find\`, \`file\`, \`list\`, \`log\`) properly before you conclude, then
exactly one of:
- It is done, or no longer as written: a \`change\` that gives it the right status or corrects it, with what you found
  as the reason. Close a decision or hypothesis only when the repository leaves no doubt.
- It is still true as written, and you have seen that it is: a \`change\` with one update op that carries only its id.
  That records that it was checked today. Do not confirm what you have not checked.
- The repository cannot tell you: send nothing for it.

When you have been through them: if there were items the repository could not tell you about, send one \`notify\`
listing the ten oldest of them by title and id, asking the owner to open each and say whether it is still true. Then
call \`rechecked\` with this repository and a summary of what you found, always, even if you changed nothing.

Finish with two or three lines saying what you sent.`;

/**
 * One run of the reader: the model is asked, what it asks for is done, and so on
 * until it has nothing more to ask, or has used what a run may. What it used is
 * recorded as a run in the repository whether it ended well or not.
 */
async function run(l: Archipelago, app: GithubApp, repo: Repo, ref: string, system: string, task: string, title: string, link: string) {
  const key = await l.secret(KEY);
  if (!(await hasReaderKey(l))) return { ran: false as const, reason: 'This workspace has no Anthropic key, so nothing reads its pushes. Its admin sets one on the Workspace screen.' };
  const me = await l.setting<string>('me');
  // It acts for the workspace's owner, as an agent's token does: it sees what they see, and what it makes is theirs.
  const mine = me ? l.as(me) : l;
  // And it is held to the one repository it is reading: what it reads there is someone else's text, and a file
  // that tried to steer it could reach nothing but that repository's own work.
  const actor: Actor = { kind: 'agent', name: 'reader', person: me, repos: [repo.entity.id] };
  const ask = asking(key);
  const kit = tools(app, repo, ref);
  const messages: Turn[] = [{ role: 'user', content: task }];
  const used = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  let turns = 0;
  let said = '';
  let failed: string | undefined;
  try {
    for (;;) {
      if (turns >= MAX_TURNS || used.input + used.output + used.cache_write > MAX_TOKENS_USED) {
        failed = `Stopped: it had taken ${turns} turns and ${used.input + used.output + used.cache_write} tokens, which is all one run may.`;
        break;
      }
      turns++;
      const answer = await ask({
        model: READER_MODEL,
        max_tokens: 16000,
        // The instructions and tools are the same for every run, and the conversation grows by its end: both are cached.
        cache_control: { type: 'ephemeral' },
        system,
        tools: kit.defs,
        output_config: { effort: 'medium' },
        // If the model declines on a safeguard, Anthropic's recommended substitute takes the request in the same call.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        messages,
      });
      used.input += answer.usage.input_tokens;
      used.output += answer.usage.output_tokens;
      used.cache_read += answer.usage.cache_read_input_tokens ?? 0;
      used.cache_write += answer.usage.cache_creation_input_tokens ?? 0;
      const text = answer.content.flatMap((b) => (b.type === 'text' ? [String(b.text)] : [])).join('\n').trim();
      if (text) said = text;
      if (answer.stop_reason === 'refusal') {
        failed = `The model declined to go on${answer.stop_details?.explanation ? `: ${answer.stop_details.explanation}` : '.'}`;
        break;
      }
      if (answer.stop_reason === 'max_tokens') {
        failed = 'Stopped: one answer ran past its length.';
        break;
      }
      messages.push({ role: 'assistant', content: answer.content });
      if (answer.stop_reason === 'pause_turn') continue;
      const calls = answer.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      if (answer.stop_reason !== 'tool_use' || !calls.length) break;
      // Every call of a turn is answered in one message, an error as an error: none is dropped.
      const results: ToolResultBlock[] = [];
      for (const call of calls) {
        try {
          const result = await kit.run(mine, actor, call.name, (call.input ?? {}) as Record<string, unknown>);
          const out = typeof result === 'string' ? result : JSON.stringify(result, null, 1);
          results.push({ type: 'tool_result', tool_use_id: call.id, content: out.length > MAX_RESULT ? `${out.slice(0, MAX_RESULT)}\n… (${out.length - MAX_RESULT} more characters not shown: ask for less at a time)` : out });
        } catch (err) {
          results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: (err as Error).message.slice(0, 4000) });
        }
      }
      messages.push({ role: 'user', content: results });
    }
  } catch (err) {
    // Said by kind, most particular first: what the owner can do about it differs.
    const who = provider();
    if (err instanceof ModelError && err.kind === 'auth') failed = `${who} refused the key. ${configured().url ? 'The server’s model key needs looking at.' : 'Set a new one on the Workspace screen.'}`;
    else if (err instanceof ModelError && err.kind === 'rate') failed = `${who}’s rate limit was reached and the run gave up.`;
    else if (err instanceof ModelError) failed = `${who} answered ${err.status ?? 'with an error'}: ${err.message.slice(0, 300)}`;
    else failed = `The run broke: ${(err as Error).message.slice(0, 300)}`;
  }
  const tokens = used.input + used.output + used.cache_write;
  const cost = (used.input * PRICE.input + used.output * PRICE.output + used.cache_read * PRICE.cache_read + used.cache_write * PRICE.cache_write) / 1e6;
  const summary = [failed, said].filter(Boolean).join('\n\n');
  const recorded = await recordRun(l, actor, { repo: repo.entity.id, title, ok: !failed, tokens, cost_usd: cost, turns, link, summary, surface: 'server' });
  return { ran: true as const, ok: !failed, run: recorded.run, tokens, turns, summary };
}

/** Read one push against the map. */
export function readPush(l: Archipelago, app: GithubApp, repo: Repo, push: { branch: string; default_branch: string; before: string; after: string }) {
  const fresh = /^0+$/.test(push.before);
  const task = `A push has just landed on the branch "${push.branch}" of ${repo.name} (default branch: "${push.default_branch}"). In the map the repository is "${repo.entity.title}" (${repo.entity.id}).
${fresh ? `The branch is new: read the commits on it that are not on the default branch (commits with base "${push.default_branch}" and head "${push.after}").` : `The new commits are ${push.before}..${push.after} (commits with that base and head).`}`;
  return run(l, app, repo, push.after, ON_PUSH, task, `Read the push to ${push.branch} (${push.after.slice(0, 7)})`, commitLink(repo, push.after));
}

/**
 * Ask whether a re-check of a repository is due, and do it if it is. Asked
 * for now (by a person, from the repository's page), it does not wait: the
 * oldest items are checked whatever each project's interval.
 */
export async function recheck(l: Archipelago, app: GithubApp, repo: Repo, branch: string, now = false) {
  const me = await l.setting<string>('me');
  const due = (await callTool(me ? l.as(me) : l, { kind: 'agent', name: 'reader', person: me }, 'view', { name: 'recheck', params: { repo: repo.entity.id, now } })) as { due: boolean; projects: { due: boolean }[] };
  if (!due.due) return { ran: false as const, reason: 'Nothing is due for a re-check.' };
  const task = `This is the ${now ? 're-check the owner asked for' : 'scheduled re-check'} for ${repo.name}. In the map the repository is "${repo.entity.title}" (${repo.entity.id}).\n\nThe projects that are due:\n${JSON.stringify(due.projects.filter((p) => p.due), null, 1)}`;
  const done = await run(l, app, repo, branch, ON_RECHECK, task, now ? 'Re-check asked for by hand' : 'Scheduled re-check', `https://github.com/${repo.name}#recheck-${new Date().toISOString().slice(0, now ? 19 : 10)}`);
  // The wait starts again whether or not the run got as far as saying so: a run that broke is not tried again every hour.
  if (done.ran) await callTool(l, { kind: 'agent', name: 'reader', person: me }, 'rechecked', { repo: repo.entity.id, summary: done.ok ? undefined : 'The re-check did not finish.' }).catch(() => undefined);
  return done;
}

const commitLink = (repo: Repo, sha: string) => `https://github.com/${repo.name}/commit/${sha}`;

/**
 * Read the pushes that were recorded and never read: a run is cut off when
 * the server stops (a deploy of Archipelago itself follows every push to its own
 * repository by half a minute), and a run that never ended left no record.
 * For each branch pushed to lately, everything since the last push that was
 * read is read as one, up to the newest. A push whose run ended, well or
 * badly, is not read again.
 */
export async function readUnread(l: Archipelago, app: GithubApp, installation: string, withinMinutes = 180): Promise<{ repo: string; branch: string; after: string }[]> {
  if (!(await hasReaderKey(l))) return [];
  const done: { repo: string; branch: string; after: string }[] = [];
  for (const repo of await readable(l, app, installation)) {
    const { rows } = await l.db.query<{ detail: { branch: string; before?: string; after?: string; commits?: unknown[] } }>(
      `select detail from event where action = 'repo.push' and target_id = $1 and ts > now() - make_interval(mins => $2::int)
         and coalesce(detail->>'branch', '') <> '' and detail->>'deleted' is null and detail->>'after' is not null order by seq desc limit 40`,
      [repo.entity.id, withinMinutes],
    );
    const settled = new Set<string>();
    let fallback: string | undefined;
    for (const { detail } of rows) {
      if (settled.has(detail.branch)) continue;
      settled.add(detail.branch);
      // Newest first on this branch, back to the last one that was read.
      const unread = [];
      for (const push of rows.filter((r) => r.detail.branch === detail.branch).map((r) => r.detail)) {
        const { rows: read } = await l.db.query(`select 1 from entity where type = any($1::text[]) and props->>'link' = $2 limit 1`, [l.registry.family('sys.run'), commitLink(repo, push.after!)]);
        if (read.length) break;
        unread.push(push);
      }
      if (!unread.length || !unread.some((p) => p.commits?.length)) continue;
      fallback ??= ((await app.asInstallation(installation, `/repos/${repo.name}`)) as { default_branch?: string }).default_branch ?? detail.branch;
      const push = { branch: detail.branch, default_branch: fallback, before: unread.at(-1)!.before ?? '0', after: unread[0].after! };
      await readPush(l, app, repo, push);
      done.push({ repo: repo.name, branch: push.branch, after: push.after });
    }
  }
  return done;
}

/** The repositories of a workspace that the app can read, as the map knows them. */
export async function readable(l: Archipelago, app: GithubApp, installation: string): Promise<Repo[]> {
  const names = new Set((await app.repositories(installation)).map((n) => n.toLowerCase()));
  const { rows } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null and props ? 'remote'`, [l.registry.family('software.repo')]);
  const out: Repo[] = [];
  for (const r of rows) {
    const match = /github\.com[:/]+([^/\s]+\/[^/\s?#]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(String(r.props.remote));
    if (match && names.has(match[1].toLowerCase())) out.push({ installation, name: match[1], entity: { id: r.id, title: r.title } });
  }
  return out;
}
