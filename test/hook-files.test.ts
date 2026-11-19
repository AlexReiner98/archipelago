// The hook writes the files the map hands it at a session's start (scripts/pelago-events.mjs, writeFiles): only a path
// the map may write, never over a file a person wrote, and the answer Claude Code reads keeps no trace of them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain script, no types
import { writeFiles } from '../scripts/pelago-events.mjs';

const MARKED = '<!-- Written from the map: change the instructions for written:CLAUDE.md there; each session start writes this file again. -->\n\n# Rules\n';

function disk(files: Record<string, string>) {
  const wrote: Record<string, string> = {};
  return { wrote, read: (at: string) => files[at] ?? null, write: (at: string, text: string) => void (wrote[at] = text) };
}

const answer = (files: unknown[]) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Hello.' }, files });

test("the map's files are written over its own and where none is, never over a person's or outside what it may write", () => {
  const d = disk({ 'C:/repo/CLAUDE.md': MARKED.replace(/\n/g, '\r\n'), 'C:/repo/CLAUDE.local.md': '# Mine, by hand\n' });
  const out = JSON.parse(
    writeFiles(
      answer([
        { path: 'CLAUDE.md', text: `${MARKED}\nNew.\n` },
        { path: 'CLAUDE.local.md', text: `${MARKED}\nPrivate.\n` },
        { path: '.claude/skills/pelago-bump/SKILL.md', text: '---\nname: pelago-bump\n---\n' },
        { path: '.claude/settings.json', text: '{"permissions":{"allow":["Bash(*)"]}}' },
        { path: '../outside/CLAUDE.md', text: 'x' },
      ]),
      'C:/repo/',
      d.read,
      d.write,
    ),
  );
  assert.deepEqual(Object.keys(d.wrote).sort(), ['C:/repo/.claude/skills/pelago-bump/SKILL.md', 'C:/repo/CLAUDE.md']);
  assert.equal(out.files, undefined, 'Claude Code reads no files key');
  assert.match(out.hookSpecificOutput.additionalContext, /^Hello\.\n\nCLAUDE\.md was written again from the map/);
  assert.match(out.hookSpecificOutput.additionalContext, /CLAUDE\.local\.md here was written by hand/);
});

test('a file already as the map has it is left alone, line ends aside, and an answer with no files is passed as it is', () => {
  const d = disk({ 'C:/repo/CLAUDE.md': MARKED.replace(/\n/g, '\r\n') });
  const out = JSON.parse(writeFiles(answer([{ path: 'CLAUDE.md', text: MARKED }]), 'C:/repo', d.read, d.write));
  assert.deepEqual(d.wrote, {});
  assert.equal(out.hookSpecificOutput.additionalContext, 'Hello.');
  const plain = JSON.stringify({ hookSpecificOutput: { additionalContext: 'Hi.' } });
  assert.equal(writeFiles(plain, 'C:/repo', d.read, d.write), plain);
  assert.equal(writeFiles(answer([{ path: 'CLAUDE.md', text: 'x' }]), undefined, d.read, d.write), JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Hello.' } }), 'outside a checkout nothing is written');
});
