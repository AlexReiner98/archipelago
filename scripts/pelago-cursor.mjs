// Cursor's hooks, said as Claude Code's so the one hook script (pelago-hook.mjs, beside this) answers them: Cursor
// names its events and fields its own way (conversation_id, workspace_roots, beforeSubmitPrompt), and takes back
// only what each of its events reads (sessionStart: additional_context). The installer writes this into
// ~/.cursor/hooks.json for sessionStart, beforeSubmitPrompt, stop and sessionEnd.
//
//   node pelago-cursor.mjs <session-start|prompt|stop|session-end>

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Cursor's input as Claude Code's: the conversation is the session, its first workspace the folder it runs in. */
export function asClaude(name, cursor) {
  const cwd = Array.isArray(cursor.workspace_roots) && typeof cursor.workspace_roots[0] === 'string' ? cursor.workspace_roots[0] : process.cwd();
  return {
    session_id: cursor.conversation_id ?? cursor.session_id,
    cwd,
    hook_event_name: name,
    ...(typeof cursor.prompt === 'string' && { prompt: cursor.prompt }),
    ...(name === 'session-end' && { reason: typeof cursor.reason === 'string' ? cursor.reason : 'other' }),
    ...(name === 'session-start' && { source: 'startup' }),
  };
}

/**
 * The hook's answer as Cursor takes it: a session's start hands the agent its context; the rest are told and nothing
 * comes back, since Cursor reads no context there, and a stop that asked for more would start another turn.
 */
export function asCursor(name, answer) {
  let said = {};
  try {
    said = JSON.parse(answer || '{}');
  } catch { /* not JSON: nothing to hand on */ }
  const context = [said.hookSpecificOutput?.additionalContext, said.systemMessage].filter(Boolean).join('\n\n');
  return name === 'session-start' && context ? { additional_context: context } : {};
}

const name = process.argv[2];
if (name && process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === process.argv[1].toLowerCase()) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  let cursor = {};
  try {
    cursor = JSON.parse(input || '{}');
  } catch { /* nothing said: the hook still runs */ }
  const hook = spawn(process.execPath, [join(fileURLToPath(new URL('.', import.meta.url)), 'pelago-hook.mjs'), name, '--plugin'], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  let out = '';
  hook.stdout.on('data', (d) => (out += d));
  hook.stdin.end(JSON.stringify(asClaude(name, cursor)));
  await new Promise((done) => hook.on('close', done));
  process.stdout.write(JSON.stringify(asCursor(name, out)));
}
