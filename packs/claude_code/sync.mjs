// The setup this pack hands out (files/setup.mjs) is made from this repository's own scripts, which stay the source:
// scripts/pelago-hook.mjs, scripts/pelago-events.mjs, scripts/pelago-setup.mjs and the bump skill. This repository's
// own .claude settings run the hook from there. Run it after changing any of them:
//
//   node packs/claude_code/sync.mjs
//
// The pack's test fails while files/setup.mjs is not what this makes. The kernel fills {origin}, {tokens}, {version}
// and {rules} when it serves the file (src/server-files.ts); the hook is given the address and the version here, in
// the project's folder, as the kernel's own setup did on the server before.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PACK = import.meta.dirname;
const ROOT = join(PACK, '..', '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
export const OUT = join(PACK, 'files', 'setup.mjs');

/** The sources, by what the setup calls each. */
export const SOURCES = { hook: 'scripts/pelago-hook.mjs', events: 'scripts/pelago-events.mjs', skill: '.claude/skills/pelago-bump/SKILL.md', setup: 'scripts/pelago-setup.mjs' };

/** What files/setup.mjs should hold. */
export function made() {
  const embed = (path) => JSON.stringify(read(path));
  return [
    '// Made by packs/claude_code/sync.mjs from scripts/pelago-setup.mjs and the files it writes: do not change it here.',
    'const ORIGIN = {origin};',
    'const TOKENS = {tokens};',
    'const VERSION = {version};',
    '// Away from this repository the hook has no local server to fall back on: it calls the one that handed it out.',
    `const HANDED_HOOK = ${embed(SOURCES.hook)}.replace("'http://127.0.0.1:3100'", JSON.stringify(ORIGIN)).replace("const SETUP = '';", \`const SETUP = '\${VERSION}';\`);`,
    'const FILES = {',
    '  hook: HANDED_HOOK,',
    `  events: ${embed(SOURCES.events)},`,
    `  skill: ${embed(SOURCES.skill)},`,
    '  home: `# Where bumps live\\n\\nWorkspace: ${ORIGIN}.\\n\\nFind the feature that gathers friction with Archipelago by search (type \\`feature\\`, q \\`friction\\`). If this workspace has none, make the bump an issue that is part of the project you are working in, and say in its first line that it is about Archipelago itself; with no issue type here, a finding about the item it concerns.\\n`,',
    '  rules: {rules},',
    '};',
    read(SOURCES.setup),
  ].join('\n');
}

if (process.argv[1] && join(process.argv[1]) === join(PACK, 'sync.mjs')) {
  writeFileSync(OUT, made());
  console.log(`Wrote ${OUT}`);
}
