// The reader: an agent on this server that keeps a workspace's map true to
// the repositories it connected through the GitHub App. When a push arrives
// it reads the new commits against the repository's open items and sends
// what they change; when a re-check is due it checks the oldest open items
// against the code. It is what the workflow in a repository's Actions did,
// with nothing to set up in the repository: it has no checkout, and reads
// through the app (which may only read).
//
// It runs on the workspace's own model account (src/model-account.ts), or on
// the server's model where the server offers one, and says what each run used
// as a run in the repository, like any other agent.

import { z } from 'zod';
import { connection, hasModel, NO_MODEL } from './model-account.ts';
import { ModelError, type Tool, type ToolResultBlock, type ToolUseBlock, type Turn } from './model.ts';
import type { Actor, Entity, Archipelago } from './pelago.ts';
import type { StartedBy } from './launcher.ts';
import { recordRun } from './sessions.ts';
import { callTool, TOOLS } from './tools.ts';
import { commitLink, leanTools, ON_PUSH_LEAN, pushBrief, sought, within, type Push, type Reach, type Repo } from './reader-push.ts';

/** A run stops when it has taken this many turns or used this many tokens (not counting cached re-reads). */
const MAX_TURNS = 40;
const MAX_TOKENS_USED = 600_000;
/** The most of one tool's answer that is handed back: a whole file or diff can be far more than is needed. */
const MAX_RESULT = 60_000;

export { sought, within } from './reader-push.ts';

const PELAGO_TOOLS = ['view', 'search', 'get', 'events', 'schema', 'proposals', 'change', 'notify', 'rechecked'];

/** What the reader can do: the map's own tools, and reading the one repository through the app. */
function tools(app: Reach, repo: Repo, ref: string): { defs: Tool[]; run: (l: Archipelago, actor: Actor, name: string, input: Record<string, unknown>) => Promise<unknown> } {
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
async function run(l: Archipelago, kit: ReturnType<typeof tools>, repo: Repo, system: string, task: string, title: string, link: string, by?: StartedBy) {
  const model = await connection(l);
  if (!model) return { ran: false as const, reason: NO_MODEL };
  const me = await l.setting<string>('me');
  // It acts for the workspace's owner, as an agent's token does: it sees what they see, and what it makes is theirs.
  const mine = me ? l.as(me) : l;
  // And it is held to the one repository it is reading: what it reads there is someone else's text, and a file
  // that tried to steer it could reach nothing but that repository's own work. Started by a push or a schedule, not by
  // the owner asking, what it changes waits for them.
  const actor: Actor = { kind: 'agent', name: 'reader', person: me, within: [repo.entity.id], ...(by && { may: 'propose' as const }) };
  const ask = model.ask;
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
        model: model.model,
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
    const who = model.name;
    if (err instanceof ModelError && err.kind === 'auth') failed = `${who} refused the key. ${model.from === 'server' ? 'The server’s model key needs looking at.' : 'Connect the account again on the Workspace page, under Model.'}`;
    else if (err instanceof ModelError && err.kind === 'rate') failed = `${who}’s rate limit was reached and the run gave up.`;
    else if (err instanceof ModelError) failed = `${who} answered ${err.status ?? 'with an error'}: ${err.message.slice(0, 300)}`;
    else failed = `The run broke: ${(err as Error).message.slice(0, 300)}`;
  }
  const tokens = used.input + used.output + used.cache_write;
  // Priced as the model it ran on is (the account's price, in US$ a million tokens); unknown, it is left out, never guessed.
  const price = model.price;
  const cost = price ? (used.input * price.input + used.output * price.output + used.cache_read * price.input * 0.1 + used.cache_write * price.input * 1.25) / 1e6 : undefined;
  const summary = [failed, said].filter(Boolean).join('\n\n');
  const recorded = await recordRun(l, actor, { repo: repo.entity.id, title, ok: !failed, tokens, cost_usd: cost, turns, link, summary, surface: 'server', started_by: by });
  return { ran: true as const, ok: !failed, run: recorded.run, tokens, turns, summary };
}

/** Read one push against the map. */
export async function readPush(l: Archipelago, app: Reach, repo: Repo, push: Push) {
  const me = await l.setting<string>('me');
  const actor: Actor = { kind: 'agent', name: 'reader', person: me, within: [repo.entity.id], may: 'propose' };
  const title = `Read the push to ${push.branch} (${push.after.slice(0, 7)})`;
  // What the model would ask for turn by turn is gathered first, in one message (src/reader-push.ts).
  let task: string;
  try {
    task = await pushBrief(callTool, me ? l.as(me) : l, actor, app, repo, push);
  } catch (err) {
    task = `A push has just landed on "${push.branch}" of ${repo.name} (${push.before}..${push.after}). What changed could not be gathered (${(err as Error).message.slice(0, 200)}): use \`diff\` on ${push.after}.`;
  }
  return run(l, leanTools(callTool, app, repo, push), repo, ON_PUSH_LEAN, task, title, commitLink(repo, push.after), { kind: 'webhook', name: `a push to ${push.branch}` });
}

/**
 * Ask whether a re-check of a repository is due, and do it if it is. Asked
 * for now (by a person, from the repository's page), it does not wait: the
 * oldest items are checked whatever each project's interval.
 */
export async function recheck(l: Archipelago, app: Reach, repo: Repo, branch: string, now = false) {
  const me = await l.setting<string>('me');
  const due = (await callTool(me ? l.as(me) : l, { kind: 'agent', name: 'reader', person: me }, 'view', { name: 'recheck', params: { repo: repo.entity.id, now } })) as { due: boolean; projects: { due: boolean }[] };
  if (!due.due) return { ran: false as const, reason: 'Nothing is due for a re-check.' };
  const task = `This is the ${now ? 're-check the owner asked for' : 'scheduled re-check'} for ${repo.name}. In the map the repository is "${repo.entity.title}" (${repo.entity.id}).\n\nThe projects that are due:\n${JSON.stringify(due.projects.filter((p) => p.due), null, 1)}`;
  const done = await run(l, tools(app, repo, branch), repo, ON_RECHECK, task, now ? 'Re-check asked for by hand' : 'Scheduled re-check', `https://github.com/${repo.name}#recheck-${new Date().toISOString().slice(0, now ? 19 : 10)}`, now ? undefined : { kind: 'automation', name: 'the scheduled re-check' });
  // The wait starts again whether or not the run got as far as saying so: a run that broke is not tried again every hour.
  if (done.ran) await callTool(l, { kind: 'agent', name: 'reader', person: me }, 'rechecked', { repo: repo.entity.id, summary: done.ok ? undefined : 'The re-check did not finish.' }).catch(() => undefined);
  return done;
}


/**
 * Read the pushes that were recorded and never read: a run is cut off when
 * the server stops (a deploy of Archipelago itself follows every push to its own
 * repository by half a minute), and a run that never ended left no record.
 * For each branch pushed to lately, everything since the last push that was
 * read is read as one, up to the newest. A push whose run ended, well or
 * badly, is not read again.
 */
export async function readUnread(l: Archipelago, app: Reach, installation: string, withinMinutes = 180): Promise<{ repo: string; branch: string; after: string }[]> {
  if (!(await hasModel(l))) return [];
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
export async function readable(l: Archipelago, app: Reach, installation: string): Promise<Repo[]> {
  const names = new Set((await app.repositories(installation)).map((n) => n.toLowerCase()));
  const { rows } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and archived_at is null and props ? 'remote'`, [l.registry.family('software.repo')]);
  const out: Repo[] = [];
  for (const r of rows) {
    const match = /github\.com[:/]+([^/\s]+\/[^/\s?#]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(String(r.props.remote));
    if (match && names.has(match[1].toLowerCase())) out.push({ installation, name: match[1], entity: { id: r.id, title: r.title, type: r.type } });
  }
  return out;
}
