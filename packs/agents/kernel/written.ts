// The files a session's harness reads that are written from the map (task e_55yajsbf; the owner, 19 Nov 2026,
// e_25cwbdjn: "The map is the source"). An instruction whose `for` names `written:<path>` is a block of that file, in
// its order: a CLAUDE.md, a CLAUDE.local.md, a skill. The session start hands each file whole beside its words, and
// the hook writes it into the checkout, marked as written from the map, over a file it wrote before and never over
// one a person wrote (scripts/pelago-hook.mjs, writeFiles).
//
// Which checkout a file goes into is the instruction's `remote` (owner/name of the repository), or, where the map
// keeps the repository, what it is about: one with neither goes into no checkout, so a workspace's CLAUDE.md never
// lands in every repository it has sessions in. Only the paths WRITABLE names are written: Claude Code's settings,
// permissions and hooks decide what an agent may run unasked, and are never written from the map.

import type { KernelContext } from '#pelago/kernel';
import { said, type KeptInstruction, type StyleDef } from './instructions.ts';

/** The place an instruction is written into a file at: `written:<path>`, the path from the checkout's root. */
export const WRITTEN = 'written:';

/** The files the map may write: the repository's instructions, the private ones, a skill. Nothing that runs or permits. */
export const WRITABLE = /^(CLAUDE(\.local)?\.md|\.claude\/skills\/[A-Za-z0-9_-]+\/SKILL\.md)$/;

/** The line a written file carries, which the hook reads to know the file is the map's to write again. */
export const MARK = '<!-- Written from the map';
const mark = (path: string) => `${MARK}: change the instructions for ${WRITTEN}${path} there; each session start writes this file again. -->`;

/** One file, whole, and the instructions it was written from. */
export interface WrittenFile {
  path: string;
  text: string;
  from: string[];
}

const listed = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** A remote as owner/name: the host, the scheme, a user and .git taken off. */
export const repoOf = (remote: string | undefined) =>
  remote
    ?.trim()
    .replace(/\.git$/i, '')
    .replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i, '')
    .replace(/^[^@/]+@[^:]+:/, '')
    .toLowerCase();

/** Whether a kept instruction is written into this checkout: its remote names it, or it is about the repository. */
const forCheckout = (one: KeptInstruction, repo: string | undefined, about: string | undefined) =>
  typeof one.props.remote === 'string' && one.props.remote.trim() ? repoOf(one.props.remote) === repo : about !== undefined && one.about.includes(about);

/** Every path the open ones are written at, that the map may write. */
export const writtenPaths = (presets: StyleDef[], kept: KeptInstruction[]) =>
  [...new Set([...presets.map((p) => p.props), ...kept.filter((k) => k.is_open).map((k) => k.props)].flatMap((props) => listed(props.for)))]
    .filter((f) => f.startsWith(WRITTEN))
    .map((f) => f.slice(WRITTEN.length))
    .filter((path) => WRITABLE.test(path))
    .sort();

/** A bullet or a numbered point: one after another with no empty line between. */
const point = (block: string) => /^(\s*[-*]|\s*\d+\.)\s/.test(block);

/** A file's text from what is said there: each block as written, a list's points together, the mark at its head. */
export function fileText(path: string, blocks: { text: string }[]): string {
  const parts = blocks.map((b) => b.text.replace(/\r\n/g, '\n').trim()).filter(Boolean);
  let body = '';
  parts.forEach((part, i) => {
    body += i === 0 ? part : `${point(part) && point(parts[i - 1]) ? '\n' : '\n\n'}${part}`;
  });
  // A skill opens on its frontmatter: its name, and its description, the first paragraph; the mark comes after.
  const skill = /^\.claude\/skills\/([^/]+)\/SKILL\.md$/.exec(path);
  if (skill) {
    const [first, ...rest] = body.split(/\n\s*\n/);
    const description = (first ?? '').replace(/\s+/g, ' ').trim();
    return `---\nname: ${skill[1]}\ndescription: ${JSON.stringify(description)}\n---\n${mark(path)}\n\n${rest.join('\n\n')}\n`;
  }
  return `${mark(path)}\n\n${body}\n`;
}

/** The files written from these, for a checkout of `remote` (or about `about`): pure, what is read is handed in. */
export function writtenFiles(presets: StyleDef[], kept: KeptInstruction[], at: { remote?: string; about?: string }): WrittenFile[] {
  const repo = repoOf(at.remote);
  // Only what is for this checkout counts; one for another repository, or for none, is not read here at all.
  const here = kept.filter((one) => forCheckout(one, repo, at.about)).map((one) => ({ ...one, about: [] }));
  return writtenPaths([], here)
    .map((path) => {
      const blocks = said(presets, here, `${WRITTEN}${path}`);
      return { path, text: fileText(path, blocks), from: blocks.map((b) => b.id) };
    })
    .filter((file) => file.from.length);
}

/** answer.written: the files written from the map into a checkout of `remote`, as its session starts. */
export async function written(ctx: KernelContext, input: { remote?: string; about?: string; island?: string }) {
  if (!input?.remote && !input?.about) return { files: [] };
  const { presets, kept } = (await ctx.reads({ told_from: { ...(typeof input.island === 'string' && { island: input.island }) } })) as { presets: StyleDef[]; kept: KeptInstruction[] };
  return { files: writtenFiles(presets, kept, { ...(typeof input.remote === 'string' && { remote: input.remote }), ...(typeof input.about === 'string' && { about: input.about }) }) };
}
