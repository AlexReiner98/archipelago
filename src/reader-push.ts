// Reading one push, kept small enough for a small model. The server gathers what the model would otherwise have to
// ask for turn by turn (the commits and what they changed, the repository's open work, the statuses each kind of item
// has) and hands it over in one message, with five narrow tools in place of the map's whole set: each turn re-sends
// the tools, and a model on an OpenAI-compatible server caches none of it. What the model sends still goes through
// the map's one write path (`change`), as the reader, held to the one repository.

import type { GithubApp } from './github-app.ts';
import type { Tool } from './model.ts';
import type { Actor, Archipelago } from './pelago.ts';
import { livesInFor } from './places.ts';
/** The map's tools, as the reader calls them: handed in, so this module does not depend on where they are kept. */
export type Call = (l: Archipelago, actor: Actor, name: string, input: unknown) => Promise<unknown>;

export interface Repo {
  installation: string;
  /** "owner/name" on GitHub. */
  name: string;
  entity: { id: string; title: string; type?: string };
}

export interface Push {
  branch: string;
  default_branch: string;
  before: string;
  after: string;
}

/** How much of what changed is handed over at once: each file's patch, and all of them together. */
const PATCH_MOST = 1_500;
const PATCHES_MOST = 12_000;
const NOTE_MOST = 800;

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

export const commitLink = (repo: Repo, sha: string) => `https://github.com/${repo.name}/commit/${sha}`;

type Changed = { filename: string; status: string; additions: number; deletions: number; patch?: string }[];

export const ON_PUSH_LEAN = `You keep a map of work true to one code repository. A push has just landed. Below are its commits, what
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
export async function pushBrief(callTool: Call, l: Archipelago, actor: Actor, app: GithubApp, repo: Repo, push: Push): Promise<string> {
  const fresh = /^0+$/.test(push.before);
  const base = fresh ? push.default_branch : push.before;
  const at = (path: string) => app.asInstallation(repo.installation, `/repos/${repo.name}${path}`);
  const compared = (await at(`/compare/${within(base)}...${within(push.after)}?per_page=100`)) as { commits: { sha: string; commit: { message: string } }[]; files?: Changed };
  let room = PATCHES_MOST;
  const files = (compared.files ?? []).map((f) => {
    const patch = (f.patch ?? '(no text diff: binary or too large)').slice(0, Math.min(PATCH_MOST, Math.max(room, 0)));
    room -= patch.length;
    const cut = (f.patch?.length ?? 0) > patch.length ? '\n… (cut: `diff` a commit for all of it)' : '';
    return `--- ${f.filename} (${f.status}, +${f.additions} -${f.deletions})\n${patch}${cut}`;
  });
  const work = (await callTool(l, actor, 'view', { name: 'repo_work', params: { repo: repo.entity.id } })) as { ready?: Item[]; blocked?: Item[] };
  const items = [...(work.ready ?? []), ...(work.blocked ?? [])];
  const kinds = [...new Set(items.map((i) => i.type))];
  const statuses = kinds.map((t) => {
    const s = l.registry.type(t)?.statuses;
    return s ? `${t}: open ${s.open.join(', ')}; closed ${s.closed.join(', ')}` : t;
  });
  return [
    `Repository ${repo.name}, "${repo.entity.title}" (${repo.entity.id}) in the map. Branch "${push.branch}"; the default branch is "${push.default_branch}".`,
    `Commits (${fresh ? `new branch, against ${push.default_branch}, up to ${push.after}` : `${push.before}..${push.after}`}):`,
    ...compared.commits.map((c) => `- ${c.sha.slice(0, 7)} ${c.commit.message.trim().replace(/\n+/g, ' / ').slice(0, 400)}`),
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

interface Item {
  id: string;
  type: string;
  title: string;
  status: string;
}

const text = { type: 'string' } as const;
const def = (name: string, description: string, properties: Record<string, unknown>, required: string[]): Tool => ({ name, description, input_schema: { type: 'object', properties, required } });

/** The five tools of a push read, and the two that read the repository further. */
export function leanTools(callTool: Call, app: GithubApp, repo: Repo, push: Push): { defs: Tool[]; run: (l: Archipelago, actor: Actor, name: string, input: Record<string, unknown>) => Promise<unknown> } {
  const defs = [
    def('update', 'Change one open item: its status, a correction to its title, or a line added to its note. why: what in the push shows it.', { id: text, status: text, title: text, append: text, why: text }, ['id', 'why']),
    def('create', 'Make a new item for work the push names but does not do. type: a kind from the list (or work.task); part_of: the id of the item it belongs to, if any.', { type: text, title: text, note: text, part_of: text, why: text }, ['type', 'title', 'why']),
    def('look', 'One item: its note and what it is linked to.', { id: text }, ['id']),
    def('find', 'Items in the map whose title or note match the words.', { words: text }, ['words']),
    def('diff', 'One commit in full: its message and each file’s whole patch.', { sha: text }, ['sha']),
    def('file', `A file of the repository as it is at the push (or at ref).`, { path: text, ref: text }, ['path']),
  ];
  const source = (sha?: unknown) => ({ uri: commitLink(repo, typeof sha === 'string' && /^[0-9a-f]{7,40}$/.test(sha) ? sha : push.after), kind: 'commit' as const });
  const change = (l: Archipelago, actor: Actor, why: unknown, ops: unknown[]) => {
    const reason = String(why ?? '').trim() || 'What the push shows';
    return callTool(l, actor, 'change', { reason, authority: { of: 'agent', basis: reason }, source: source(), ops });
  };
  const at = (path: string) => app.asInstallation(repo.installation, `/repos/${repo.name}${path}`);
  const run = async (l: Archipelago, actor: Actor, name: string, input: Record<string, unknown>): Promise<unknown> => {
    switch (name) {
      case 'update': {
        const op: Record<string, unknown> = { op: 'update', id: String(input.id ?? '') };
        for (const k of ['status', 'title', 'append'] as const) if (typeof input[k] === 'string' && input[k]) op[k] = input[k];
        if (Object.keys(op).length === 2) throw new Error('Say what to change: status, title or append.');
        return change(l, actor, input.why, [op]);
      }
      case 'create': {
        const parent = typeof input.part_of === 'string' && input.part_of ? input.part_of : undefined;
        const link = parent ? { op: 'link', type: 'part_of', from: 'n', to: parent } : { op: 'link', type: livesInFor(l, repo.entity.type ?? ''), from: 'n', to: repo.entity.id };
        return change(l, actor, input.why, [{ op: 'create', ref: 'n', type: String(input.type ?? ''), title: String(input.title ?? ''), ...(input.note ? { body: String(input.note) } : {}) }, link]);
      }
      case 'look': {
        const got = (await callTool(l, actor, 'get', { id: String(input.id ?? '') })) as { entity: { id: string; type: string; title: string; status: string; body?: string }; outgoing?: Link[]; incoming?: Link[] };
        const e = got.entity;
        const links = [...(got.outgoing ?? []).map((r) => `${r.type} → ${r.id} ${r.title} [${r.status}]`), ...(got.incoming ?? []).map((r) => `${r.id} ${r.title} [${r.status}] → ${r.type}`)].slice(0, 20);
        return [`${e.id} ${e.type} [${e.status}] ${e.title}`, (e.body ?? '').slice(0, NOTE_MOST), ...links].join('\n');
      }
      case 'find': {
        const found = (await callTool(l, actor, 'search', { q: String(input.words ?? ''), limit: 10 })) as Item[];
        return found.map((i) => `${i.id} ${i.type} [${i.status}] ${i.title}`).join('\n') || 'Nothing matches.';
      }
      case 'diff': {
        const c = (await at(`/commits/${within(input.sha)}`)) as { sha: string; commit: { message: string }; files?: Changed };
        return [`${c.sha.slice(0, 7)} ${c.commit.message}`, ...(c.files ?? []).map((f) => `--- ${f.filename} (${f.status})\n${f.patch ?? '(no text diff)'}`)].join('\n');
      }
      case 'file': {
        const f = (await at(`/contents/${within(input.path)}?ref=${encodeURIComponent(String(input.ref ?? push.after))}`)) as { type?: string; content?: string };
        if (Array.isArray(f) || f.type !== 'file') throw new Error(`${input.path} is not a file.`);
        return Buffer.from(f.content ?? '', 'base64').toString('utf8');
      }
      default:
        throw new Error(`No tool "${name}". The tools are: update, create, look, find, diff, file.`);
    }
  };
  return { defs, run };
}

interface Link {
  type: string;
  id: string;
  title: string;
  status: string;
}
