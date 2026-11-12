// A hook answered as Claude Code reads it, for the tests that check what a session is told: the kernel's neutral
// answer (packs/sessions/kernel/hook-answers.ts) put in Claude Code's shape by the claude_code pack's handler, as the server does at
// /hooks/<event> (packs/loader/kernel/server-adapter.ts), without the pack's sandbox in between.
import { sessionAnswer, type HookAsk } from '../packs/sessions/kernel/hook-answers.ts';
import { ownContext } from '../packs/loader/kernel/kernel-context.ts';
import type { Q } from '../packs/database/kernel/db.ts';
import type { Archipelago } from '../packs/write/kernel/pelago.ts';
// @ts-expect-error A pack's handler is plain JavaScript.
import { hookIn, hookOut } from '../packs/claude_code/handler.js';

/** A hook as the server hands it: the map as the token's person sees it (the whole database is no longer read). */
export interface HookCall extends HookAsk {
  whole?: Q;
  pelago: Archipelago;
}

export async function answerHook(event: string, call: HookCall): Promise<object | undefined> {
  const inward = hookIn({ event, body: call.body }) as { event?: string; body?: HookCall['body'] };
  const neutral = inward.event === undefined ? {} : await answerOn(inward.event, { ...call, body: inward.body ?? {} });
  return neutral && (hookOut({ event, kernel: inward.event, answer: neutral }) as object);
}

/** The sessions pack's answer, on its own context of the map the hook reads. */
const answerOn = (event: string, { pelago, whole: _whole, ...call }: HookCall) => sessionAnswer(ownContext(pelago, 'sessions'), event, call);
