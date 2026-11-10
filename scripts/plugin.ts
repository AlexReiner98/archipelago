// The Claude Code plugin, made from this repository's own files: the hook and what it loads, the working rules and
// the map's tools at the hosted server, signed in to through the browser. `npm run plugin` writes it
// under plugins/archipelago/, beside the marketplace file (.claude-plugin/marketplace.json) that lets anyone install
// it with one command (which the installer, scripts/pelago-install.mjs, runs for them). test/plugin.test.ts says when
// what is written is behind its sources.
//
//   claude plugin install archipelago --marketplace AlexReiner98/archipelago

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { LISTING } from '../src/listing.ts';
import { shippedRules } from '../src/working-rules.ts';

const ROOT = join(import.meta.dirname, '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** The server the plugin connects to unless PELAGO_URL says another. */
export const HOSTED = 'https://app.archipelago.tools';
/** The plugin's name, its marketplace's, and the MCP server's: the tools are mcp__plugin_archipelago_pelago__<tool>. */
export const PLUGIN = 'archipelago';
export const SERVER = 'pelago';
export const FOLDER = `plugins/${PLUGIN}`;
/** Where the plugin directory looks for the listing's icon. */
export const PLUGIN_ICON = `${FOLDER}/.claude-plugin/icon.png`;
/** Where the marketplace is, as Claude Code is told it. */
export const MARKETPLACE = 'AlexReiner98/archipelago';
export const installCommand = `claude plugin install ${PLUGIN} --marketplace ${MARKETPLACE}`;

const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const DESCRIPTION = LISTING.summary;

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

/**
 * The plugin directory's build, at plugins/archipelago-directory/: the directory takes no hook that runs a command, no
 * headersHelper and no credential read from the machine from an organization that isn't Verified. So its tools are at
 * the hosted server's fixed address, signed in to by Claude Code itself, and its hooks call those tools (report, action
 * hook: src/hook-tool.ts) with what Claude Code hands them. Claude Code runs none of them at launch, and the server is
 * gone by a session's end: the session starts at its first prompt, and ends as its agent reports it.
 */
export const DIRECTORY = `plugins/${PLUGIN}-directory`;
export const DIRECTORY_ICON = `${DIRECTORY}/.claude-plugin/icon.png`;
/** Its MCP server's name: not pelago, which Claude Code drops as a duplicate where the installer set one up already. */
export const DIRECTORY_SERVER = 'map';
const DIRECTORY_HOOKS: [event: string, name: string, matcher: string | undefined, said: Record<string, string>][] = [
  ['SessionStart', 'session-start', 'clear|compact', { source: '${source}' }],
  ['UserPromptSubmit', 'prompt', undefined, { prompt: '${prompt}' }],
  ['Stop', 'stop', undefined, { stop_hook_active: '${stop_hook_active}' }],
];
function directoryHooks() {
  const all: Record<string, unknown[]> = {};
  for (const [event, name, matcher, said] of DIRECTORY_HOOKS)
    (all[event] ??= []).push({ ...(matcher && { matcher }), hooks: [{ type: 'mcp_tool', server: `plugin:${PLUGIN}:${DIRECTORY_SERVER}`, tool: 'report', input: { action: 'hook', params: { event: name, session_id: '${session_id}', cwd: '${cwd}', ...said } } }] });
  return { description: 'Tells Archipelago a session was prompted and ended a turn, through its own tools.', hooks: all };
}

/** A README made from its template: {title}, {summary} and the listing's other words and addresses filled in. */
const filled = (template: string) =>
  read(template).replace(/\r\n/g, '\n').replace(/\{(\w+)\}/g, (all, key) => {
    const value = key in LISTING.urls ? LISTING.urls[key as keyof typeof LISTING.urls] : (LISTING as Record<string, unknown>)[key];
    return typeof value === 'string' ? value : all;
  });

/** Every file of the plugin, its directory build and the marketplace, by its path in this repository. */
export function pluginFiles(): Record<string, string> {
  const version = JSON.parse(read('package.json')).version as string;
  const at = (path: string) => `${FOLDER}/${path}`;
  const manifest = json({
    name: PLUGIN,
    displayName: LISTING.title,
    version,
    description: DESCRIPTION,
    author: { name: LISTING.publisher, url: LISTING.urls.site },
    homepage: LISTING.urls.app,
    repository: LISTING.urls.repository,
    license: LISTING.license,
    keywords: LISTING.keywords,
    privacyPolicyUrl: LISTING.urls.privacy,
    // The directory's other links, read for the listing as privacyPolicyUrl is.
    termsOfServiceUrl: LISTING.urls.terms,
    supportUrl: LISTING.urls.support,
    documentationUrl: LISTING.urls.docs,
  });
  return {
    // The MCP Registry's entry (registry.modelcontextprotocol.io), published with mcp-publisher under the domain's name.
    'server.json': json({
      $schema: 'https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json',
      name: LISTING.registry_name,
      title: LISTING.title,
      description: LISTING.summary,
      version,
      websiteUrl: LISTING.urls.site,
      repository: { url: LISTING.urls.repository, source: 'github' },
      remotes: [{ type: 'streamable-http', url: LISTING.urls.mcp }],
    }),
    '.claude-plugin/marketplace.json': json({
      name: PLUGIN,
      owner: { name: LISTING.publisher },
      metadata: { description: `${LISTING.name} for Claude Code.` },
      plugins: [{ name: PLUGIN, source: `./${FOLDER}`, description: DESCRIPTION, category: LISTING.category }],
    }),
    [at('.claude-plugin/plugin.json')]: manifest,
    // No token in it: the tools take the machine's one sign-in (pelago-login.mjs headers), the one the installer and
    // the hooks use; with none, the helper says nothing and Claude Code signs in itself, at /mcp.
    [at('.mcp.json')]: json({ mcpServers: { [SERVER]: { type: 'http', url: `\${PELAGO_URL:-${HOSTED}}/mcp`, headersHelper: `node "\${CLAUDE_PLUGIN_ROOT}/scripts/pelago-login.mjs" headers` } } }),
    [at('hooks/hooks.json')]: json(hooks()),
    // Away from this repository the hook has no local server to fall back on: it calls the hosted one.
    [at('scripts/pelago-hook.mjs')]: read('scripts/pelago-hook.mjs').replace(`'http://127.0.0.1:3100'`, JSON.stringify(HOSTED)),
    [at('scripts/pelago-events.mjs')]: read('scripts/pelago-events.mjs'),
    [at('scripts/pelago-login.mjs')]: read('scripts/pelago-login.mjs').replace(`'http://127.0.0.1:3100'`, JSON.stringify(HOSTED)),
    // The plugin's own README, opening with the listing's summary, and what the plugin sends.
    [at('README.md')]: filled('scripts/plugin-readme.md'),
    [at('pelago.md')]: shippedRules(),
    // The directory's build: the same listing, no script, and the working rules handed over by the server at the start.
    [`${DIRECTORY}/.claude-plugin/plugin.json`]: manifest,
    [`${DIRECTORY}/.mcp.json`]: json({ mcpServers: { [DIRECTORY_SERVER]: { type: 'http', url: LISTING.urls.mcp } } }),
    [`${DIRECTORY}/hooks/hooks.json`]: json(directoryHooks()),
    // The directory's listing text, and what this build sends, for the directory's review.
    [`${DIRECTORY}/README.md`]: filled('scripts/plugin-readme-directory.md'),
  };
}

if (import.meta.main) {
  for (const [path, text] of Object.entries(pluginFiles())) {
    mkdirSync(dirname(join(ROOT, path)), { recursive: true });
    writeFileSync(join(ROOT, path), text);
    console.log(`written  ${path}`);
  }
  // The listing's icon, as the plugin directory takes it: a square PNG in the plugin's own folder.
  for (const icon of [PLUGIN_ICON, DIRECTORY_ICON]) {
    copyFileSync(join(ROOT, LISTING.icon), join(ROOT, icon));
    console.log(`written  ${icon}`);
  }
}
