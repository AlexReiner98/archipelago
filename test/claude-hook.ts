// A hook answered as Claude Code reads it, for the tests that check what a session is told: the kernel's neutral
// answer (src/hook-answers.ts) put in Claude Code's shape by the claude_code pack's handler, as the server does at
// /hooks/<event> (src/server-adapter.ts), without the pack's sandbox in between.
import { sessionAnswer, type HookCall } from '../src/hook-answers.ts';
// @ts-expect-error A pack's handler is plain JavaScript.
import { hookIn, hookOut } from '../packs/claude_code/handler.js';

export async function answerHook(event: string, call: HookCall): Promise<object | undefined> {
  const inward = hookIn({ event, body: call.body }) as { event?: string; body?: HookCall['body'] };
  const neutral = inward.event === undefined ? {} : await sessionAnswer(inward.event, { ...call, body: inward.body ?? {} });
  return neutral && (hookOut({ event, kernel: inward.event, answer: neutral }) as object);
}
