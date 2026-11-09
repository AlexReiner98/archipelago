// The Claude Code plugin, made from this repository's own files: the hook and what it loads, the working rules, the
// bump skill, and the map's tools at the hosted server, signed in to through the browser. `npm run plugin` writes it
// under plugins/archipelago/, beside the marketplace file (.claude-plugin/marketplace.json) that lets anyone install
// it with two commands in Claude Code. test/plugin.test.ts says when what is written is behind its sources.
//
//   /plugin marketplace add AlexReiner98/archipelago
//   /plugin install archipelago@archipelago

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { workingRules } from '../src/working-rules.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** The server the plugin connects to unless PELAGO_URL says another. */
export const HOSTED = 'https://app.archipelago.tools';
/** The plugin's name, its marketplace's, and the MCP server's: the tools are mcp__plugin_archipelago_pelago__<tool>. */
export const PLUGIN = 'archipelago';
export const SERVER = 'pelago';
export const FOLDER = `plugins/${PLUGIN}`;
export const installCommands = [`/plugin marketplace add AlexReiner98/archipelago`, `/plugin install ${PLUGIN}@${PLUGIN}`];

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const DESCRIPTION = 'A map of your work your agent keeps and you can read: sessions, plans, decisions and what waits on what, drawn in your browser.';

/** The hooks, as the setup registers them in a project (scripts/pelago-setup.mjs), run from the plugin. */
const HOOKS: [event: string, name: string, matcher?: string, timeout?: number, async?: boolean][] = [
  ['SessionStart', 'session-start', 'startup|resume|clear'],
  ['UserPromptSubmit', 'prompt'],
  ['Stop', 'stop'],
  ['SessionEnd', 'session-end', undefined, 30],
  ['PostToolUse', 'file-used', 'Read|Edit|Write|MultiEdit|NotebookEdit'],
  ['Notification', 'notification'],
  ['StopFailure', 'stop-failure'],
  ['PostToolUse', 'tool-used', undefined, 10, true],
];

function hooks() {
  const all: Record<string, unknown[]> = {};
  for (const [event, name, matcher, timeout, async] of HOOKS)
    (all[event] ??= []).push({ ...(matcher && { matcher }), hooks: [{ type: 'command', command: `node "\${CLAUDE_PLUGIN_ROOT}/scripts/pelago-hook.mjs" ${name} --plugin`, ...(timeout && { timeout }), ...(async && { async }) }] });
  return { description: 'Tells Archipelago a session started, was prompted, ended, and what it touched.', hooks: all };
}

/** Every file of the plugin and the marketplace, by its path in this repository. */
export function pluginFiles(): Record<string, string> {
  const version = JSON.parse(read('package.json')).version as string;
  const at = (path: string) => `${FOLDER}/${path}`;
  return {
    '.claude-plugin/marketplace.json': json({
      name: PLUGIN,
      owner: { name: 'Aperture Design Tools Inc.' },
      metadata: { description: 'Archipelago for Claude Code.' },
      plugins: [{ name: PLUGIN, source: `./${FOLDER}`, description: DESCRIPTION, category: 'productivity' }],
    }),
    [at('.claude-plugin/plugin.json')]: json({
      name: PLUGIN,
      version,
      description: DESCRIPTION,
      author: { name: 'Aperture Design Tools Inc.' },
      homepage: HOSTED,
      repository: 'https://github.com/AlexReiner98/archipelago',
      license: 'MIT',
      keywords: ['memory', 'map', 'tasks', 'decisions', 'mcp'],
    }),
    // No token in it: Claude Code signs in through the browser, at /mcp.
    [at('.mcp.json')]: json({ mcpServers: { [SERVER]: { type: 'http', url: `\${PELAGO_URL:-${HOSTED}}/mcp` } } }),
    [at('hooks/hooks.json')]: json(hooks()),
    // Away from this repository the hook has no local server to fall back on: it calls the hosted one.
    [at('scripts/pelago-hook.mjs')]: read('scripts/pelago-hook.mjs').replace(`'http://127.0.0.1:3100'`, JSON.stringify(HOSTED)),
    [at('scripts/pelago-events.mjs')]: read('scripts/pelago-events.mjs'),
    [at('scripts/pelago-login.mjs')]: read('scripts/pelago-login.mjs'),
    [at('pelago.md')]: workingRules(),
    [at('skills/pelago-bump/SKILL.md')]: read('.claude/skills/pelago-bump/SKILL.md'),
    [at('skills/pelago-bump/references/home.md')]: `# Where bumps live\n\nWorkspace: the one the map's tools are signed in to (${HOSTED} unless PELAGO_URL says another).\n\nFind the feature that gathers friction with Archipelago by search (type \`feature\`, q \`friction\`). If this workspace has none, make the bump an issue that is part of the project you are working in, and say in its first line that it is about Archipelago itself.\n`,
  };
}

if (import.meta.main) {
  for (const [path, text] of Object.entries(pluginFiles())) {
    mkdirSync(dirname(join(ROOT, path)), { recursive: true });
    writeFileSync(join(ROOT, path), text);
    console.log(`written  ${path}`);
  }
}
