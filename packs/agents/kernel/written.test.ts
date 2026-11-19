// Files written from the map, without a database: which instructions go into which checkout's file, and how the file reads.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { fileText, MARK, repoOf, written, writtenFiles } from './written.ts';
import type { KeptInstruction } from './instructions.ts';

const kept = (id: string, body: string, props: Record<string, unknown>, about: string[] = []): KeptInstruction => ({ id, title: id, body, is_open: true, props, about });

test('a remote reads as owner/name, whatever its scheme', () => {
  for (const r of ['https://github.com/AlexReiner98/archipelago.git', 'git@github.com:AlexReiner98/archipelago.git', 'https://x@github.com/alexreiner98/archipelago']) assert.equal(repoOf(r), 'alexreiner98/archipelago');
});

test("a repository's file holds its own instructions, in order, and no other repository's", () => {
  const all = [
    kept('b', '- **Two.** the second', { for: ['written:CLAUDE.md'], order: 20, remote: 'AlexReiner98/archipelago' }),
    kept('a', '# Rules\n\nThe lead.', { for: ['written:CLAUDE.md'], order: 10, remote: 'AlexReiner98/archipelago' }),
    kept('c', '- **Three.** the third', { for: ['written:CLAUDE.md'], order: 30, remote: 'AlexReiner98/archipelago' }),
    kept('other', 'Not here.', { for: ['written:CLAUDE.md'], remote: 'someone/else' }),
    kept('anywhere', 'Into no checkout.', { for: ['written:CLAUDE.md'] }),
    kept('settings', '{"permissions":{}}', { for: ['written:.claude/settings.json'], remote: 'AlexReiner98/archipelago' }),
  ];
  const files = writtenFiles([], all, { remote: 'https://github.com/AlexReiner98/archipelago.git' });
  assert.deepEqual(files.map((f) => f.path), ['CLAUDE.md'], 'settings are never written from the map');
  assert.deepEqual(files[0].from, ['a', 'b', 'c']);
  assert.ok(files[0].text.startsWith(MARK));
  assert.match(files[0].text, /# Rules\n\nThe lead\.\n\n- \*\*Two\.\*\* the second\n- \*\*Three\.\*\* the third\n$/);
  assert.equal(writtenFiles([], all, { remote: 'nobody/here' }).length, 0);
});

test('a retired instruction leaves its file, and one about the repository counts where the map keeps it', () => {
  const all = [kept('a', 'Kept.', { for: ['written:CLAUDE.local.md'] }, ['e_repo']), { ...kept('b', 'Gone.', { for: ['written:CLAUDE.local.md'] }, ['e_repo']), is_open: false }];
  const [file] = writtenFiles([], all, { about: 'e_repo' });
  assert.equal(file.path, 'CLAUDE.local.md');
  assert.doesNotMatch(file.text, /Gone/);
});

test('a skill opens on its frontmatter, its first paragraph the description', () => {
  const text = fileText('.claude/skills/pelago-bump/SKILL.md', [{ text: 'Record friction\nas it happens.\n\n# Bump\n\nSteps.' }]);
  assert.match(text, /^---\nname: pelago-bump\ndescription: "Record friction as it happens\."\n---\n<!-- Written from the map/);
  assert.match(text, /# Bump\n\nSteps\.\n$/);
});

test('answer.written reads the instructions once, and nothing without a checkout', async () => {
  let reads = 0;
  const ctx = { reads: async () => (reads++, { presets: [], kept: [kept('a', 'Hi.', { for: ['written:CLAUDE.md'], remote: 'o/r' })] }), call: async () => { throw new Error('no root.rules_file here'); } } as unknown as KernelContext;
  assert.deepEqual(await written(ctx, {}), { files: [] });
  assert.equal(reads, 0);
  const { files } = await written(ctx, { remote: 'git@github.com:o/r.git' });
  assert.deepEqual(files.map((f) => f.path), ['CLAUDE.md'], 'a server that cannot word the rules file hands none');
});

test('every checkout is given the working rules as the server words them, with the run they are said to', async () => {
  const asked: unknown[] = [];
  const ctx = { reads: async () => ({ presets: [], kept: [] }), call: async (name: string, input: unknown) => (asked.push([name, input]), { text: '# Working with Archipelago\n' }) } as unknown as KernelContext;
  const { files } = await written(ctx, { run: 'e_run' });
  assert.deepEqual(files.map((f) => [f.path, f.text]), [['.claude/pelago.md', '# Working with Archipelago\n']]);
  assert.deepEqual(asked, [['root.rules_file', { run: 'e_run' }]]);
});
