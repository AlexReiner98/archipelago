// Sessions gone quiet: every so often the leader looks for open sessions that have stopped reporting, tells the human
// once about each that still holds something, and ends one that has said nothing for the house style's
// quiet_end_after. The look is this pack's, on its context, and runs as its filling of the loader's slot
// loader.leading (tick): every 30 seconds in each workspace while the server leads, on a map that has sessions on
// (the owner, 12 Nov 2026, e_nxqn32mb; packs/loader/kernel/leading.ts). An optional pack has no timers of its own.

import type { KernelContext } from '#pelago/kernel';
import { sessionEvents } from './session-events.ts';
import { sessionEnd } from './sessions.ts';
import { operational } from './bookkeeping.ts';
import type { Item } from './types.ts';

/** Minutes without a word before an open session is taken to be gone, and ended for it: the house style's `quiet_end_after`, or this while a style lacks it. */
export const QUIET_END_AFTER = 1440;
/** Minutes without a report before an open session is shown as stale (the sessions view's). */
const STALE_MINUTES = 30;
const PELAGO = { kind: 'agent' as const, name: 'pelago' };

/** The workspace style's number of minutes, read each pass so the owner's change shows on the next. */
async function quietEndAfter(ctx: KernelContext): Promise<number> {
  const { style } = await ctx.call<object, { style: Record<string, unknown> }>('answer.view_style', {});
  const n = (style.numbers as Record<string, unknown> | undefined)?.quiet_end_after;
  return typeof n === 'number' && n > 0 ? n : QUIET_END_AFTER;
}

/** One pass, a failure told to the owner (act.report.alert). */
export async function tick(ctx: KernelContext): Promise<void> {
  await flagStaleSessions(ctx).catch((err) =>
    ctx.call('act.report.alert', { key: 'sessions-quiet', title: 'Looking for quiet sessions failed', body: `A pass over the open sessions failed: ${(err as Error).message}`, from: 'pelago' }),
  );
}

/** Tell the human, once, about each open session that has stopped reporting; end it once it has said nothing for quiet_end_after. */
export async function flagStaleSessions(ctx: KernelContext): Promise<void> {
  const { open, links } = (await ctx.reads({ open_runs: { links: ['holds'] } })) as { open: (Item & { created_at: Date | string })[]; links: { run: string; title: string }[] };
  const seenAt = (r: Item) => (r.props.last_seen as string | undefined) ?? new Date(r.created_at).toISOString();
  const stale = open.filter((r) => Date.now() - Date.parse(seenAt(r)) > STALE_MINUTES * 60_000);
  if (!stale.length) return;
  const endAfter = await quietEndAfter(ctx);
  const hours = Math.round(endAfter / 60);
  for (const run of stale) {
    // A heartbeat sets last_seen; a hook's raw events do not, and are a word from it too.
    const events = await sessionEvents(ctx, run.id);
    const heard = Math.max(Date.parse(seenAt(run)), ...events.map((e) => Date.parse(e.at)).filter(Number.isFinite));
    if (Date.now() - heard <= STALE_MINUTES * 60_000) continue;
    // Nothing for that long: its window was shut, or its machine was. It is ended for it, as its end hook
    // would have ended it, what it held is given back, and its works_on closes, so it leaves its task's canvas.
    if (Date.now() - heard > endAfter * 60_000) {
      await sessionEnd(ctx, PELAGO, { run: run.id, outcome: 'finished', reason: 'quiet', summary: `Not heard from for over ${hours} hours: ended for it` });
      continue;
    }
    if (run.props.stale_flagged) continue;
    await operational(ctx, run.id, { props: { stale_flagged: true } }, { actor: 'agent:pelago', action: 'run.stale', reason: `No report for over ${STALE_MINUTES} minutes` });
    // Its tab on the owner's page goes until it next shows something (ui/tab-life.js); not while a turn is under way.
    if (run.props.busy !== true) await ctx.call('act.report.took', { whose: await ctx.reads({ whose: true }), step: { kind: 'other', actor: 'agent:pelago', did: 'quiet', rests: true, run: run.id } }).catch(() => {});
    // Worth a person's attention only when it keeps something from everyone else: the rest end by themselves.
    const holds = links.filter((h) => h.run === run.id);
    if (!holds.length || !ctx.registry.type('notification')) continue;
    await ctx.call('act.report.notify', {
      actor: PELAGO,
      title: `Session "${run.title}" has gone quiet`,
      body: `It still holds: ${holds.map((h) => h.title).join(', ')}. End it from its page to release them; left alone, it is ended after ${hours} hours.`,
      level: 'warning',
      about: run.id,
    });
  }
}
