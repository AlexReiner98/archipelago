// What a machine with no Archipelago checkout is handed to work with this server: the install pages and scripts (GET
// /connect/install and its short addresses), the one command that sets a project up, and a running system's request
// for a token of its own, which a person approves (./token-ask.ts), and its poll. Nothing in it is secret: the token
// stays in the machine's environment.
//
// The routes are the surface's (packs/surface/kernel/connect-routes.ts: which names the server answers to, how often
// an address may ask, who is signed in); this answers each with its words. Sign-in is identity's (the owner, 12 Nov
// 2026, e_wuqn82rf).

import type { KernelContext } from '#pelago/kernel';
import { installPage, installPs1, installScript, installSh, llmsTxt } from './install.ts';
import { askForToken, pollForToken } from './token-ask.ts';

/** The one command, with no secret in it, that sets a project up or brings its files up to date. */
export const setupCommand = (origin: string) => `node -e "fetch('${origin}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))"`;

/** What /connect/install hands out, by path: its type and its text for this server's address. */
const INSTALL: Record<string, [string, (origin: string, rules: () => string) => string]> = {
  '/connect/install': ['text/plain', installPage],
  '/connect/install.md': ['text/markdown', installPage],
  '/connect/install.mjs': ['text/javascript', (origin, rules) => installScript(origin, rules())],
  '/connect/install.ps1': ['text/plain', installPs1],
  '/connect/install.sh': ['text/x-shellscript', installSh],
  '/connect/llms.txt': ['text/plain', llmsTxt],
};

/**
 * What an install path hands out for this server's address: its type and its text, or undefined for no such path. The
 * working rules a project is handed are the loader's (which packs the server turns on): the surface hands them in.
 */
export function installed(path: string, origin: string, rules: () => string): { type: string; text: string } | undefined {
  const at = Object.hasOwn(INSTALL, path) ? INSTALL[path] : undefined;
  return at && { type: at[0], text: at[1](origin, rules) };
}

/** A system's request for its token (POST /connect/request), answered with what it shows and polls with. */
export async function asked(ctx: KernelContext, body: unknown, origin: string, workspace: string): Promise<{ status: number; body: unknown }> {
  try {
    const ask = await askForToken(ctx, body);
    return {
      status: 200,
      body: {
        code: ask.code,
        poll: { url: `${origin}/connect/poll/${workspace}/${ask.id}`, secret: ask.secret },
        approve_at: `${origin}/`,
        expires_at: ask.expires_at,
        note: `Show the code. A person approves it on Home, or on the page of an item watched at an address you named. Poll every few seconds with POST and Authorization: Bearer <secret> until it says approved (with the token, given once), refused or gone.`,
      },
    };
  } catch (err) {
    return { status: 400, body: { error: (err as Error).message } };
  }
}

/** A system's poll for its token (POST /connect/poll/<workspace>/<id>, its secret as the bearer). */
export async function polled(ctx: KernelContext, workspace: string, id: string, secret: string): Promise<{ status: number; body: unknown }> {
  const answer = await pollForToken(ctx, id, secret);
  return { status: answer.state === 'gone' ? 410 : 200, body: answer };
}
