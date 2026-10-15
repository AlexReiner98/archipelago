// What a machine with no Archipelago checkout needs to work with this server: the
// hook script, the friction skill and the working rules are files in this
// repository, so the server hands them out, wrapped in one script that puts
// each where Claude Code looks for it (scripts/pelago-setup.mjs). Nothing in
// it is secret: the token stays in the machine's environment.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/**
 * Which hand-out this server gives: a mark that moves when any file the setup
 * writes does (the hook, the rules, the skill, the setup itself and so the
 * hooks it registers). The setup writes it into the project's hook, which
 * says it with every call, so a session can be told its project is behind.
 */
export const SETUP_VERSION = createHash('sha256')
  .update(['scripts/pelago-hook.mjs', '.claude/skills/pelago-bump/SKILL.md', 'examples/working-rules.md', 'scripts/pelago-setup.mjs'].map(read).join('\n'))
  .digest('hex')
  .slice(0, 12);

/** The one command, with no secret in it, that sets a project up or brings its files up to date. */
export const setupCommand = (origin: string) => `node -e "fetch('${origin}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))"`;

/** The setup script for a project that is to work with the server at this address; tokens says whether that server asks for one. */
export function setupScript(origin: string, tokens = true): string {
  const files = {
    // Away from this repository the hook has no local server to fall back on: it calls the one that handed it out.
    hook: read('scripts/pelago-hook.mjs').replace(`'http://127.0.0.1:3100'`, JSON.stringify(origin)).replace(`const SETUP = '';`, `const SETUP = '${SETUP_VERSION}';`),
    skill: read('.claude/skills/pelago-bump/SKILL.md'),
    home: `# Where bumps live\n\nWorkspace: ${origin}.\n\nFind the feature that gathers friction with Archipelago by search (type \`software.feature\`, q \`friction\`). If this workspace has none, make the bump an issue that is part of the project you are working in, and say in its first line that it is about Archipelago itself.\n`,
    rules: read('examples/working-rules.md'),
  };
  return `const ORIGIN = ${JSON.stringify(origin)};\nconst TOKENS = ${tokens};\nconst FILES = ${JSON.stringify(files)};\n${read('scripts/pelago-setup.mjs')}`;
}
