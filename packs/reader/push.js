// Reading one push, kept small enough for a small model. The pack gathers what the model would otherwise have to ask
// for turn by turn (the commits and what they changed, the repository's open work, the statuses each kind of item
// has) and hands it over in one message, with six narrow tools in place of the map's whole set: each turn re-sends
// the tools, and a model on an OpenAI-compatible server caches none of it. What the model sends still goes through
// the map's one write path (change), as the reader, held to the one repository.

import { commitLink, gh, within, fileText } from './github.js';

/** How much of what changed is handed over at once: each file's patch, and all of them together. */
const PATCH_MOST = 1_500;
const PATCHES_MOST = 12_000;
const NOTE_MOST = 800;

export const ON_PUSH = `You keep a map of work true to one code repository. A push has just landed. Below are its commits, what
they changed, and the repository's open items with the statuses each kind of item may have. Decide what this push
changes in the map, and say it with the tools. Most pushes change little or nothing.

- An open item this push finished, on the default branch: \`update\` it to a closing status of its kind.
- An open item this push visibly started: \`update\` it to the status that says so.
- A title or note this push made wrong: \`update\` it with the correction.
- Work the push names but does not do (a follow-up in a message, a TODO it adds): \`create\` it. Never create an item
  for work this push itself did: that work is finished, not to do.
- On a branch other than the default, work is in progress, never finished.
- Use only the statuses listed. Use \`look\`, \`find\`, \`diff\` or \`file\` only when what is below is not enough.
- When in doubt, change nothing: a wrong change is worse than none.

Finish with one or two lines saying what you changed, or that nothing needed changing.`;

/** The one message the model starts from: the push, what it changed, and the open work it may touch. */
export async function pushBrief(ctx, repo, push) {
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
  const work = (await ctx.read({ view: 'repo_work', params: { repo: repo.entity.id } })) ?? {};
  const items = [...(work.ready ?? []), ...(work.blocked ?? [])];
  const statuses = [];
  for (const t of [...new Set(items.map((i) => i.type))]) {
    const s = (await ctx.read({ type_info: t }))?.statuses;
    statuses.push(s ? `${t}: open ${s.open.join(', ')}; closed ${s.closed.join(', ')}` : t);
  }
  return [
    `Repository ${repo.name}, "${repo.entity.title}" (${repo.entity.id}) in the map. Branch "${push.branch}"; the default branch is "${push.default_branch}".`,
    `Commits (${fresh ? `new branch, against ${push.default_branch}, up to ${push.after}` : `${push.before}..${push.after}`}):`,
    ...(compared.commits ?? []).map((c) => `- ${c.sha.slice(0, 7)} ${c.commit.message.trim().replace(/\n+/g, ' / ').slice(0, 400)}`),
    '',
    'What changed:',
    ...(files.length ? files : ['(no files)']),
    '',
    `Open items of this repository (${items.length}):`,
    ...(items.length ? items.map((i) => `- ${i.id} ${i.type} [${i.status}] ${i.title}`) : ['(none)']),
    '',
    'Statuses by kind:',
    ...(statuses.length ? statuses : ['(no open items)']),
    '',
    'Items an earlier commit said it fixes (with "fixes e_…") are already closed: leave them.',
  ].join('\n');
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

/** The run that reads one push. */
export async function pushRun(ctx, repo, push) {
  let task;
  try {
    task = await pushBrief(ctx, repo, push);
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
    context: { kind: 'push', repo, push },
  };
}

/** Answer one of the push read's tools: what it changes is answered as a change, made as the run's agent. */
export async function pushTool(ctx, name, input, { repo, push }) {
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
      return change(input.why, [op]);
    }
    case 'create': {
      const parent = typeof input.part_of === 'string' && input.part_of ? input.part_of : undefined;
      const lives = parent ? 'part_of' : ((await ctx.read({ type_info: repo.entity.type ?? '' }))?.lives_in ?? 'lives_in');
      const link = { op: 'link', type: lives, from: 'n', to: parent ?? repo.entity.id };
      return change(input.why, [{ op: 'create', ref: 'n', type: String(input.type ?? ''), title: String(input.title ?? ''), ...(input.note ? { body: String(input.note) } : {}) }, link]);
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
