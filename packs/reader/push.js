// Reading one push, kept small enough for a small model. The pack gathers what the model would otherwise have to ask
// for turn by turn (the commits and what they changed, the repository's open work, the statuses each kind of item
// has) and hands it over in one message, with six narrow tools in place of the map's whole set: each turn re-sends
// the tools, and a model on an OpenAI-compatible server caches none of it. What the model sends still goes through
// the map's one write path (change), as the reader, held to the one repository.

import { commitLink, gh, within, fileText } from './github.js';
import { alike } from './history.js';
import { filesFor, shortlist, shows } from './shortlist.js';

/** How much of the diff is handed over: for each item asked about, and in all. */
const ITEM_MOST = 6_000;
const PATCHES_MOST = 24_000;
const NOTE_MOST = 800;

export const ON_PUSH = `You keep a map of work true to one code repository. A push has just landed. Below are its commits, the open
items it may have finished (candidates), each with its note and the part of the diff that touches it, and the rest of
the repository's open items. Most pushes finish little or nothing.

- For each candidate, call \`decide\` once: finished true only when a commit says so in its own words (closes, fixes,
  done, naming it) or the diff plainly does the whole of it, and give as quote one line of a commit message or of the
  diff, copied word for word, that shows it. A commit about something near the item's subject has not done it.
- Another open item: \`decide\` on it only if a commit plainly finishes it.
- Never set an open status such as doing: a push shows what was finished, not what was begun.
- A title or note this push made wrong: \`update\` it with the correction.
- Work the push names but does not do (a follow-up in a message, a TODO it adds): \`create\` it, once \`find\` shows it
  is not there already. Never create an item for work this push itself did: that work is finished, not to do.
- Items marked "unreviewed" are your own guesses from an earlier push, not the owner's: leave them.
- Use \`look\`, \`find\`, \`diff\` or \`file\` only when what is below is not enough. Where a file is cut, \`diff\` the commit.
- When in doubt, finished is false: a wrong close is worse than none.

Finish with one or two lines saying what you changed, or that nothing needed changing.`;

/** The ids of items a commit's message names. */
const namedIn = (messages) => [...new Set(messages.join('\n').match(/\be_[a-z0-9]{8}\b/g) ?? [])];

/** The items the sessions that said they work on this branch were working on. */
async function workedOn(ctx, push) {
  const runs = await ctx.read({ items: { type: 'sys.run', where: { branch: push.branch } }, fields: ['branch'] });
  const ids = [];
  for (const r of runs.slice(-20)) for (const t of await ctx.read({ related: r.id, relation: 'sys.works_on' })) ids.push(t.id);
  return ids;
}

/** A file's patch, up to room, saying what was cut. */
function shown(f, room) {
  const patch = f.patch ?? '(no text diff: binary or too large)';
  const cut = patch.length > room ? `\n… (cut: ${patch.length - room} more characters; \`diff\` a commit for all of it)` : '';
  return `--- ${f.filename} (${f.status}, +${f.additions} -${f.deletions})\n${patch.slice(0, Math.max(room, 0))}${cut}`;
}

/**
 * The one message the model starts from: the push, the items it may have finished each with what of the diff
 * touches it, and the rest of the open work. Commits read before (read: their first seven characters) are named as
 * such; the reader's own unreviewed items are marked. On a branch other than the default nothing is finished, so
 * there are no candidates: what a commit names is closed by the GitHub pack's own reading.
 */
export async function pushBrief(ctx, repo, push, { read = new Set(), own = [] } = {}) {
  const fresh = /^0+$/.test(push.before);
  const base = fresh ? push.default_branch : push.before;
  const compared = await gh(ctx, `/repos/${repo.name}/compare/${within(base)}...${within(push.after)}?per_page=100`);
  const items = await openWork(ctx, repo);
  const commits = (compared.commits ?? []).filter((c) => !read.has(c.sha.slice(0, 7)));
  const earlier = (compared.commits ?? []).length - commits.length;
  const files = compared.files ?? [];
  const messages = commits.map((c) => c.commit.message);
  const main = push.branch === push.default_branch;
  const candidates = main ? shortlist(items, { messages, files }, { named: namedIn(messages), worked: await workedOn(ctx, push) }) : [];
  let room = PATCHES_MOST;
  const given = new Set();
  const sections = [];
  for (const { item, why } of candidates) {
    const full = await ctx.read({ get: item.id });
    const its = filesFor({ ...item, body: full?.body }, files);
    let mine = Math.min(ITEM_MOST, room);
    const parts = [];
    for (const f of its) {
      if (given.has(f.filename)) {
        parts.push(`--- ${f.filename}: above`);
        continue;
      }
      if (mine <= 0) break;
      const text = shown(f, Math.min(mine, room));
      given.add(f.filename);
      mine -= text.length;
      room -= text.length;
      parts.push(text);
    }
    sections.push(`## ${item.id} ${item.type} [${item.status}] ${item.title}${own.includes(item.id) ? ' (unreviewed)' : ''}`, `Why asked: ${why}.`, ...(full?.body ? [`Note: ${full.body.slice(0, NOTE_MOST).replace(/\n+/g, ' ')}`] : []), ...(parts.length ? parts : ['(no file of the push names its words)']), '');
  }
  // What no candidate needed, briefly: a main push with no candidates, or a branch, shows each file's start.
  const rest = files.filter((f) => !given.has(f.filename));
  const restShown = rest.map((f) => {
    if (room <= 0) return `--- ${f.filename} (${f.status}, +${f.additions} -${f.deletions})`;
    const text = shown(f, Math.min(1_500, room));
    room -= text.length;
    return text;
  });
  const statuses = [];
  for (const t of [...new Set(items.map((i) => i.type))]) {
    const s = (await ctx.read({ type_info: t }))?.statuses;
    statuses.push(s ? `${t}: open ${s.open.join(', ')}; closed ${s.closed.join(', ')}` : t);
  }
  const asked = new Set(candidates.map((c) => c.item.id));
  return [
    `Repository ${repo.name}, "${repo.entity.title}" (${repo.entity.id}) in the map. Branch "${push.branch}"; the default branch is "${push.default_branch}".`,
    ...(main ? [] : [`This is not the default branch: nothing is finished here, so decide on nothing. What a commit names with "Closes: e_…" is closed for you.`]),
    `Commits (${fresh ? `new branch, against ${push.default_branch}, up to ${push.after}` : `${push.before}..${push.after}`}):`,
    ...(earlier ? [`(${earlier} more were read before, on another branch: what they did is in the map already)`] : []),
    ...commits.map((c) => `- ${c.sha.slice(0, 7)} ${c.commit.message.trim().replace(/\n+/g, ' / ').slice(0, 400)}`),
    '',
    ...(main ? [`Candidates (${candidates.length}): decide on each.`, ...(sections.length ? sections : ['(none: no open item is near this push)', '']) ] : []),
    'Other files changed:',
    ...(restShown.length ? restShown : ['(none)']),
    '',
    `Other open items of this repository (${items.length - asked.size}):`,
    ...items.filter((i) => !asked.has(i.id)).map((i) => `- ${i.id} ${i.type} [${i.status}] ${i.title}${own.includes(i.id) ? ' (unreviewed)' : ''}`),
    '',
    'Statuses by kind:',
    ...(statuses.length ? statuses : ['(no open items)']),
  ].join('\n');
}

/** The repository's open work, as the software pack lists it. */
export async function openWork(ctx, repo) {
  const work = (await ctx.read({ view: 'repo_work', params: { repo: repo.entity.id } })) ?? {};
  return [...(work.ready ?? []), ...(work.blocked ?? [])];
}

const text = { type: 'string' };
const def = (name, description, properties, required) => ({ name, description, input_schema: { type: 'object', properties, required } });

/** The seven tools of a push read: five on the map, two that read the repository further. */
export const PUSH_TOOLS = [
  def('decide', 'Whether this push finished one open item. finished: true or false. quote: one line of a commit message or of the diff, word for word, that shows it finished (needed when true). why: in a sentence.', { id: text, finished: { type: 'boolean' }, quote: text, why: text }, ['id', 'finished', 'why']),
  def('update', 'Correct one open item: its title, or a line added to its note. why: what in the push shows it. To close one, decide.', { id: text, title: text, append: text, why: text }, ['id', 'why']),
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
    case 'decide': {
      const id = String(input.id ?? '');
      if (input.finished !== true) return { answer: `${id} left as it is.` };
      const now = await ctx.read({ get: id });
      if (!now) throw new Error(`No item "${id}".`);
      if (own.includes(id)) throw new Error(`${id} is your own guess from an earlier push, not yet reviewed by the owner: leave it.`);
      // A push finishes things on the default branch; on another, what a commit names is closed by GitHub's reading.
      if (push.branch !== push.default_branch) throw new Error(`"${push.branch}" is not the default branch: nothing is finished there. Decide finished false.`);
      const type = await ctx.read({ type_info: now.type });
      const status = type?.statuses?.closed?.[0];
      if (!status || type.settles) throw new Error(`${id} is a question: a commit cannot say what was decided. Leave it.`);
      if (now.is_open === false) throw new Error(`${id} is closed already. Leave it.`);
      // Checked before it is held for the owner: what shows it finished has to be in the push, word for word.
      const compared = await gh(ctx, `/repos/${repo.name}/compare/${within(/^0+$/.test(push.before) ? push.default_branch : push.before)}...${within(push.after)}?per_page=100`);
      const pushed = { messages: (compared.commits ?? []).map((c) => c.commit.message), files: compared.files ?? [] };
      if (!shows(input.quote, pushed)) throw new Error(`That quote is not in this push. Quote one line of a commit message or one line the diff adds, word for word (12 characters or more), that shows ${id} finished; if there is none, decide finished false.`);
      if (await ctx.read({ proposed: { op: 'update', id, status } })) return { answer: `Closing ${id} is waiting for the owner already.` };
      return change(`${String(input.why ?? '').trim() || 'The push finishes it'} ("${String(input.quote).trim().slice(0, 200)}")`, [{ op: 'update', id, status }]);
    }
    case 'update': {
      if (input.status !== undefined) throw new Error('To close an item, decide; a push sets no other status.');
      const op = { op: 'update', id: String(input.id ?? '') };
      for (const k of ['title', 'append']) if (typeof input[k] === 'string' && input[k]) op[k] = input[k];
      if (Object.keys(op).length === 2) throw new Error('Say what to change: title or append.');
      // What it already is, it is not set to again: an update that changes nothing is no reading of the push.
      const now = await ctx.read({ get: op.id });
      if (!now) throw new Error(`No item "${op.id}".`);
      if (op.title === now.title) delete op.title;
      if (Object.keys(op).length === 2) throw new Error(`Nothing to change: ${op.id} is already "${now.title}" [${now.status}]. Leave it.`);
      if (own.includes(op.id)) throw new Error(`${op.id} is your own guess from an earlier push, not yet reviewed by the owner: leave it.`);
      return change(input.why, [op]);
    }
    case 'create': {
      // No copies: what is open already, or waiting for the owner already, is named back instead.
      const title = String(input.title ?? '');
      const there = (await ctx.read({ tool: 'search', input: { q: title, open: true, limit: 10 } })).find((i) => alike(i.title, title));
      if (there) throw new Error(`Already there: ${there.id} ${there.type} [${there.status}] "${there.title}". Change that one if the push shows it; never make a copy.`);
      // Nor a second of what this read, or an earlier one, made and the owner has not looked at yet.
      const held = (await ctx.read({ tool: 'proposals', input: {} })).flatMap((p) => p.ops ?? []).find((o) => o.op === 'create' && alike(o.title, title));
      if (held) throw new Error(`Making "${held.title}" is waiting for the owner already: that is this one. Make it once.`);
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
      throw new Error(`No tool "${name}". The tools are: decide, update, create, look, find, diff, file.`);
  }
}

/** A push recorded against a repository (the GitHub pack's repo.push), as the reader reads it: commits to a branch, not a tag or a branch deleted. */
export function readablePush(event) {
  const d = event?.detail ?? {};
  if (!d.branch || d.deleted || d.tag !== undefined || !d.after || !d.commits?.length) return undefined;
  return { branch: d.branch, before: d.before ?? '0', after: d.after };
}
