// What a machine with no Lattice checkout needs to work with this server: the
// hook script, the friction skill and the working rules are files in this
// repository, so the server hands them out, wrapped in one script that puts
// each where Claude Code looks for it (scripts/lattice-setup.mjs). Nothing in
// it is secret: the token stays in the machine's environment.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** The setup script for a project that is to work with the server at this address. */
export function setupScript(origin: string): string {
  const files = {
    // Away from this repository the hook has no local server to fall back on: it calls the one that handed it out.
    hook: read('scripts/lattice-hook.mjs').replace(`'http://127.0.0.1:3100'`, JSON.stringify(origin)),
    skill: read('.claude/skills/lattice-bump/SKILL.md'),
    home: `# Where bumps live\n\nWorkspace: ${origin}.\n\nFind the feature that gathers friction with Lattice by search (type \`software.feature\`, q \`friction\`). If this workspace has none, make the bump an issue that is part of the project you are working in, and say in its first line that it is about Lattice itself.\n`,
    rules: read('examples/working-rules.md'),
  };
  return `const ORIGIN = ${JSON.stringify(origin)};\nconst FILES = ${JSON.stringify(files)};\n${read('scripts/lattice-setup.mjs')}`;
}
