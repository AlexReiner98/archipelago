// Claude Code's wire onto the session contract: the one module that knows how Claude Code's hooks want their answers.
// What a session is told (src/hook-answers.ts) is the same for any surface; here it is put in the shape Claude Code
// reads: additional context under the hook's own event name, and a Stop hook's block. The words said only to Claude Code
// (how to load a tool again, how to reconnect) are core's instructions, for server_restarted and setup_behind.

import type { Actor } from './pelago.ts';

/** The actor a Claude Code session's hooks act as. */
export const CLAUDE_CODE: Actor = { kind: 'agent', name: 'claude-code' };

/** Claude Code's name for the hook each of the server's hook events answers. */
const HOOK_EVENT: Record<string, string> = { 'session-start': 'SessionStart', prompt: 'UserPromptSubmit', 'file-used': 'PostToolUse' };

/** What a session is told at an event, as Claude Code's hook reads it; what else is said beside it (extra) is the hook script's. */
export const toldAs = (event: string, text: string, extra: object = {}) => ({ hookSpecificOutput: { hookEventName: HOOK_EVENT[event] ?? event, additionalContext: text }, ...extra });

/** A reply's end that asks the agent to go on, as Claude Code's Stop hook reads it. */
export const goOn = (reason: string) => ({ decision: 'block' as const, reason });

/** A neutral answer (src/hook-answers.ts) in the shape Claude Code's hooks read: told as additional context, go_on as a block. */
export function claudeCodeAnswer(event: string, { told, go_on, ...rest }: { told?: string; go_on?: string; [more: string]: unknown }): object {
  if (told !== undefined) return toldAs(event, told, rest);
  if (go_on !== undefined) return { ...goOn(go_on), ...rest };
  return rest;
}
