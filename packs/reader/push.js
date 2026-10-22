// Reading one push, kept small enough for a small model. The pack gathers what the model would otherwise have to ask
// for turn by turn (the commits and what they changed, the repository's open work, the statuses each kind of item
// has) and hands it over in one message, with six narrow tools in place of the map's whole set: each turn re-sends
// the tools, and a model on an OpenAI-compatible server caches none of it. What the model sends still goes through
// the map's one write path (change), as the reader, held to the one repository.

import { commitLink, gh, within, fileText } from './github.js';
import { alike } from './history.js';

/** How much of what changed is handed over at once: each file's patch, and all of them together. */
const PATCH_MOST = 1_500;
const PATCHES_MOST = 12_000;
const NOTE_MOST = 800;

export const ON_PUSH = `You keep a map of work true to one code repository. A push has just landed. Below are its commits, what
they changed, and the repository's open items with the statuses each kind of item may have. Decide what this push
changes in the map, and say it with the tools. Most pushes change little or nothing.

Only what a commit shows counts:
- An open item a commit finished: \`update\` it to a closing status of its kind, only on the default branch, and only
  when the commit says so in its own words (closes, fixes, done, naming the item) or its diff plainly does the whole
  of it. A commit about something near the item's subject has not done it.
- Never set an open status such as doing: a push shows what was finished, not what was begun.
- A title or note this push made wrong: \`update\` it with the correction.
- Work the push names but does not do (a follow-up in a message, a TODO it adds): \`create\` it, once \`find\` shows it
  is not there already. Never create an item for work this push itself did: that work is finished, not to do.
- Items marked "unreviewed" are your own guesses from an earlier push, not the owner's: leave them.
- Use only the statuses listed. Use \`look\`, \`find\`, \`diff\` or \`file\` only when what is below is not enough.
- When in doubt, change nothing: a wrong change is worse than none.

Finish with one or two lines saying what you changed, or that nothing needed changing.`;

/**
 * The one message the model starts from: the push, what it changed, and the open work it may touch. Commits read
 * before (read: their first seven characters) are named as such; the reader's own unreviewed items are marked.
 */
export async function pushBrief(ctx, repo, push, { read = new Set(), own = [] } = {}) {
  const fresh = /^0+$/.test(push.before);
  const base = fresh ? push.default_branch : push.before;
  const compared = await gh(ctx, `/repos/${repo.name}/compare/${within(base)}...${within(push.after)}?per_page=100`);
  let room = PATCHES_MOST;
  const files = (compared.files ?? []).map((f) => {
    const patch = (f.patch ?? '(no text diff: binary or too large)').slice(0, Math.min(PATCH_MOST, Math.max(room, 0)));
    room -= patch.length;
    const cut = (f.patch?.length ?? 0) > patch.length ? '\n… (cut: `diff` a commit for all of it)' : '';
    return `--- ${f.filename} (${f.status}, +${f.additions} -${f.deletions})\n${patch}${cut}`;
  });
  const items = await openWork(ctx, repo);
  const commits = (compared.commits ?? []).filter((c) => !read.has(c.sha.slice(0, 7)));
  const earlier = (compared.commits ?? []).length - commits.length;
  const statuses = [];
  for (const t of [...new Set(items.map((i) => i.type))]) {
    const s = (await ctx.read({ type_info: t }))?.statuses;
    statuses.push(s ? `${t}: open ${s.open.join(', ')}; closed ${s.closed.join(', ')}` : t);
  }
  return [
    `Repository ${repo.name}, "${repo.entity.title}" (${repo.entity.id}) in the map. Branch "${push.branch}"; the default branch is "${push.default_branch}".`,
    `Commits (${fresh ? `new branch, against ${push.default_branch}, up to ${push.after}` : `${push.before}..${push.after}`}):`,
    ...(earlier ? [`(${earlier} more were read before, on another branch: what they did is in the map already)`] : []),
    ...commits.map((c) => `- ${c.sha.slice(0, 7)} ${c.commit.message.trim().replace(/\n+/g, ' / ').slice(0, 400)}`),
    '',
    'What changed:',
    ...(files.length ? files : ['(no files)']),
    '',
    `Open items of this repository (${items.length}):`,
    ...(items.length ? items.map((i) => `- ${i.id} ${i.type} [${i.status}] ${i.title}${own.includes(i.id) ? ' (unreviewed)' : ''}`) : ['(none)']),
    '',
    'Statuses by kind:',
    ...(statuses.length ? statuses : ['(no open items)']),
    '',
    'Items an earlier commit said it fixes (with "fixes e_…") are already closed: leave them.',
  ].join('\n');
}

/** The repository's open work, as the software pack lists it. */
export async function openWork(ctx, repo) {
  const work = (await ctx.read({ view: 'repo_work', params: { repo: repo.entity.id } })) ?? {};
  return [...(work.ready ?? []), ...(work.blocked ?? [])];
}

const text = { type: 'string' };
const def = (name, description, properties, required) => ({ name, description, input_schema: { type: 'object', properties, required } });

/** The six tools of a push read: four on the map, two that read the repository further. */
export const PUSH_TOOLS = [
  def('update', 'Change one open item: its status, a correction to its title, or a line added to its note. why: what in the push shows it.', { id: text, status: text, title: text, append: text, why: text }, ['id', 'why']),
  def('create', 'Make a new item for work the push names but does not do. type: a kind from the list (or work.task); part_of: the id of the item it belongs to, if any.', { type: text, title: text, note: text, part_of: text, why: text }, ['type', 'title', 'why']),
  def('look', 'One item: its note and what it is linked to.', { id: text }, ['id']),
  def('find', 'Items in the map whose title or note match the words.', { words: text }, ['words']),
  def('diff', 'One commit in full: its message and each file’s whole patch.', { sha: text }, ['sha']),
  def('file', 'A file of the repository as it is at the push (or at ref).', { path: text, ref: text }, ['path']),
];

/** The run that reads one push, once whichever server asks first. seen: the commits read before, and the reader's own guesses. */
export async function pushRun(ctx, repo, push, seen = {}) {
  let task;
  try {
    task = await pushBrief(ctx, repo, push, seen);
  } catch (err) {
    task = `A push has just landed on "${push.branch}" of ${repo.name} (${push.before}..${push.after}). What changed could not be gathered (${String(err.message).slice(0, 200)}): use \`diff\` on ${push.after}.`;
  }
  return {
    title: `Read the push to ${push.branch} (${push.after.slice(0, 7)})`,
    system: ON_PUSH,
    task,
    tools: PUSH_TOOLS,
    within: [repo.entity.id],
    link: commitLink(repo, push.after),
    by: `a push to ${push.branch}`,
    context: { kind: 'push', repo, push, own: seen.own ?? [] },
    once: `push:${repo.name.toLowerCase()}@${push.after}`,
  };
}

/** Answer one of the push read's tools: what it changes is answered as a change, made as the run's agent. */
export async function pushTool(ctx, name, input, { repo, push, own = [] }) {
  const source = { uri: commitLink(repo, push.after), kind: 'commit' };
  const change = (why, ops) => {
    const reason = String(why ?? '').trim() || 'What the push shows';
    return { changes: [{ ops, reason, authority: { of: 'agent', basis: reason }, source }] };
  };
  switch (name) {
    case 'update': {
      const op = { op: 'update', id: String(input.id ?? '') };
      for (const k of ['status', 'title', 'append']) if (typeof input[k] === 'string' && input[k]) op[k] = input[k];
      if (Object.keys(op).length === 2) throw new Error('Say what to change: status, title or append.');
      // What it already is, it is not set to again: an update that changes nothing is no reading of the push.
      const now = await ctx.read({ get: op.id });
      if (!now) throw new Error(`No item "${op.id}".`);
      if (op.status === now.status) delete op.status;
      if (op.title === now.title) delete op.title;
      if (Object.keys(op).length === 2) throw new Error(`Nothing to change: ${op.id} is already "${now.title}" [${now.status}]. Leave it.`);
      if (own.includes(op.id)) throw new Error(`${op.id} is your own guess from an earlier push, not yet reviewed by the owner: leave it.`);
      if (op.status !== undefined) {
        // Only what a commit shows: a push finishes things on the default branch, and starts nothing.
        if (push.branch !== push.default_branch) throw new Error(`"${push.branch}" is not the default branch: nothing is finished there, so change no status.`);
        const closed = (await ctx.read({ type_info: now.type }))?.statuses?.closed ?? [];
        if (!closed.includes(op.status)) throw new Error(`Only a closing status (${closed.join(', ') || 'none'}): a push shows what was finished, not what was begun.`);
      }
      return change(input.why, [op]);
    }
    case 'create': {
      // No copies: what is open already, or waiting for the owner already, is named back instead.
      const title = String(input.title ?? '');
      const there = (await ctx.read({ tool: 'search', input: { q: title, open: true, limit: 10 } })).find((i) => alike(i.title, title));
      if (there) throw new Error(`Already there: ${there.id} ${there.type} [${there.status}] "${there.title}". Change that one if the push shows it; never make a copy.`);
      if (await ctx.read({ proposed: { op: 'create', title } })) throw new Error(`Making "${title}" is waiting for the owner already.`);
      const parent = typeof input.part_of === 'string' && input.part_of ? input.part_of : undefined;
      const lives = parent ? 'part_of' : ((await ctx.read({ type_info: repo.entity.type ?? '' }))?.lives_in ?? 'lives_in');
      const link = { op: 'link', type: lives, from: 'n', to: parent ?? repo.entity.id };
      return change(input.why, [{ op: 'create', ref: 'n', type: String(input.type ?? ''), title, ...(input.note ? { body: String(input.note) } : {}) }, link]);
    }
    case 'look': {
      const got = await ctx.read({ tool: 'get', input: { id: String(input.id ?? '') } });
      const e = got.entity;
      const links = [...(got.outgoing ?? []).map((r) => `${r.type} → ${r.id} ${r.title} [${r.status}]`), ...(got.incoming ?? []).map((r) => `${r.id} ${r.title} [${r.status}] → ${r.type}`)].slice(0, 20);
      return { answer: [`${e.id} ${e.type} [${e.status}] ${e.title}`, (e.body ?? '').slice(0, NOTE_MOST), ...links].join('\n') };
    }
    case 'find': {
      const found = await ctx.read({ tool: 'search', input: { q: String(input.words ?? ''), limit: 10 } });
      return { answer: found.map((i) => `${i.id} ${i.type} [${i.status}] ${i.title}`).join('\n') || 'Nothing matches.' };
    }
    case 'diff': {
      const c = await gh(ctx, `/repos/${repo.name}/commits/${within(input.sha)}`);
      return { answer: [`${c.sha.slice(0, 7)} ${c.commit.message}`, ...(c.files ?? []).map((f) => `--- ${f.filename} (${f.status})\n${f.patch ?? '(no text diff)'}`)].join('\n') };
    }
    case 'file':
      return { answer: await fileText(ctx, repo, input.path, input.ref ?? push.after) };
    default:
      throw new Error(`No tool "${name}". The tools are: update, create, look, find, diff, file.`);
  }
}

/** A push recorded against a repository (the GitHub pack's repo.push), as the reader reads it: commits to a branch, not a tag or a branch deleted. */
export function readablePush(event) {
  const d = event?.detail ?? {};
  if (!d.branch || d.deleted || d.tag !== undefined || !d.after || !d.commits?.length) return undefined;
  return { branch: d.branch, before: d.before ?? '0', after: d.after };
}
