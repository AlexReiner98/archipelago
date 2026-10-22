// The re-check: the oldest open items of a repository's projects (the software pack's recheck view says which are
// due) checked against its code, with the map's own tools and six that read the repository.

import { gh, fileText, sought, within } from './github.js';

/** The map's tools a re-check offers as they are. */
export const MAP_TOOLS = ['view', 'search', 'get', 'events', 'schema', 'proposals', 'change', 'notify', 'rechecked'];

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

export const ON_RECHECK = `${ABOUT}

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

const text = { type: 'string' };
const def = (name, description, properties, required = []) => ({ name, description, input_schema: { type: 'object', properties, required } });

/** The tools that read the one repository. */
export const repoTools = (repo, ref) => [
  def('commits', `The commits between two points in ${repo.name}, oldest first, each with its message and the files it changed. Give base and head as commit ids or branch names.`, { base: text, head: text }, ['base', 'head']),
  def('diff', 'One commit in full: its message and what it changed in each file.', { sha: text }, ['sha']),
  def('file', `A file's contents in ${repo.name}. ref is a commit id or branch (left out: ${ref}).`, { path: text, ref: text }, ['path']),
  def('list', 'What is in a folder of the repository (left out: its top). ref as for file.', { path: text, ref: text }),
  def('log', 'The latest commits, newest first, each with its date and the first line of its message. path limits it to commits that touched a file or folder; limit is how many (30 when left out, 100 at most).', { path: text, limit: { type: 'number' } }),
  def('find', 'Search the repository’s code on its default branch for words or an exact phrase. Answers with the files that match and the lines around each match.', { query: text }, ['query']),
];

/** The run of a re-check that is due, or undefined when nothing is. Asked for now, the oldest items are checked whatever each project's interval. */
export async function recheckRun(ctx, repo, ref, now = false) {
  const due = await ctx.read({ view: 'recheck', params: { repo: repo.entity.id, now } });
  if (!due?.due) return undefined;
  const task = `This is the ${now ? 're-check the owner asked for' : 'scheduled re-check'} for ${repo.name}. In the map the repository is "${repo.entity.title}" (${repo.entity.id}).\n\nThe projects that are due:\n${JSON.stringify(due.projects.filter((p) => p.due), null, 1)}`;
  return {
    title: now ? 'Re-check asked for by hand' : 'Scheduled re-check',
    system: ON_RECHECK,
    task,
    tools: repoTools(repo, ref),
    map_tools: MAP_TOOLS,
    within: [repo.entity.id],
    link: `https://github.com/${repo.name}#recheck-${String(ctx.now).slice(0, now ? 19 : 10)}`,
    by: 'the scheduled re-check',
    context: { kind: 'recheck', repo, ref },
    then: 'rechecked',
  };
}

const changed = (files, patches) => (files ?? []).map((f) => ({ file: f.filename, status: f.status, added: f.additions, removed: f.deletions, ...(patches && { patch: f.patch ?? '(no text diff: binary or too large)' }) }));

/** Answer one of the re-check's tools that read the repository. */
export async function repoTool(ctx, name, input, { repo, ref }) {
  const at = (path) => gh(ctx, `/repos/${repo.name}${path}`);
  switch (name) {
    case 'commits': {
      const c = await at(`/compare/${within(input.base)}...${within(input.head)}?per_page=100`);
      return { answer: { commits: c.commits.map((x) => ({ sha: x.sha.slice(0, 10), by: x.commit.author?.name, at: x.commit.author?.date, message: x.commit.message })), files: changed(c.files, false) } };
    }
    case 'diff': {
      const c = await at(`/commits/${within(input.sha)}`);
      return { answer: { sha: c.sha, message: c.commit.message, files: changed(c.files, true) } };
    }
    case 'file':
      return { answer: await fileText(ctx, repo, input.path, input.ref ?? ref) };
    case 'list': {
      const entries = await at(`/contents/${within(input.path)}?ref=${encodeURIComponent(String(input.ref ?? ref))}`);
      if (!Array.isArray(entries)) throw new Error(`${input.path} is a file. Use file to read it.`);
      return { answer: entries.map((e) => (e.type === 'dir' ? `${e.name}/` : `${e.name} (${e.size} bytes)`)) };
    }
    case 'log': {
      const n = Math.min(Math.max(Number(input.limit) || 30, 1), 100);
      const list = await at(`/commits?per_page=${n}${input.path ? `&path=${encodeURIComponent(String(input.path))}` : ''}`);
      return { answer: list.map((c) => `${c.sha.slice(0, 10)} ${c.commit.author?.date?.slice(0, 10) ?? ''} ${c.commit.message.split('\n')[0]}`) };
    }
    case 'find': {
      const found = await gh(ctx, `/search/code?per_page=20&q=${encodeURIComponent(`${sought(input.query)} repo:${repo.name}`)}`);
      return { answer: (found.items ?? []).map((i) => i.path) };
    }
    default:
      throw new Error(`No tool "${name}".`);
  }
}
