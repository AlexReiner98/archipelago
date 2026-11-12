// Sessions gone quiet: every so often the leader looks for open sessions that have stopped reporting, tells the human
// once about each that still holds something, and ends one that has said nothing for the house style's
// quiet_end_after. This loop once also ran the kernel's automations; they are the automations pack's now, on the
// clock's item.due (src/due.ts, decisions under e_zqap4dhg, the owner, 11 Nov 2026).

import type { Archipelago } from '../../../src/pelago.ts';
import { notify } from '../../../src/notify.ts';
import { bypassingRls } from '../../../src/outbox.ts';
import { took } from '../../../src/presence.ts';
import { alertOwner } from '../../../src/alert.ts';
import { sessionEvents } from './session-events.ts';
import { sessionEnd } from './sessions.ts';
import { keptOf } from '../../../src/query-kept.ts';
import { styleFor } from '../../../src/styles.ts';
import { VIEWS } from '../../../src/views.ts';

/** Minutes without a word before an open session is taken to be gone, and ended for it: the house style's `quiet_end_after`, or this while a style lacks it. */
export const QUIET_END_AFTER = 1440;

/** The workspace style's number of minutes, read each pass so the owner's change shows on the next. */
async function quietEndAfter(l: Archipelago): Promise<number> {
  const { style } = await styleFor(l, await keptOf(l, 'style', undefined), {});
  const n = (style.numbers as Record<string, unknown> | undefined)?.quiet_end_after;
  return typeof n === 'number' && n > 0 ? n : QUIET_END_AFTER;
}

export class QuietSessions {
  readonly l: Archipelago;
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;

  constructor(l: Archipelago) {
    this.l = l;
  }

  start(everyMs = 30_000): void {
    this.timer = setInterval(() => void this.tick().catch((err) => alertOwner(this.l, { key: 'sessions-quiet', title: 'Looking for quiet sessions failed', body: `A pass over the open sessions failed: ${(err as Error).message}`, from: 'pelago' })), everyMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** One pass: flag sessions gone quiet, and end those quiet for too long. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.flagStaleSessions();
    } finally {
      this.busy = false;
    }
  }

  /** Tell the human, once, about each open session that has stopped reporting; end it once it has said nothing for quiet_end_after. */
  private async flagStaleSessions(): Promise<void> {
    const view = (await VIEWS.sessions.run(this.l, {})) as { stale_after_minutes: number; open: { id: string; title: string; stale: boolean; busy: boolean; last_seen: string; holds: { title: string }[] }[] };
    const stale = view.open.filter((r) => r.stale);
    if (!stale.length) return;
    const endAfter = await quietEndAfter(this.l);
    const hours = Math.round(endAfter / 60);
    for (const run of stale) {
      // A heartbeat sets last_seen; a hook's raw events do not, and are a word from it too.
      const events = await sessionEvents(this.l, run.id);
      const heard = Math.max(Date.parse(run.last_seen), ...events.map((e) => Date.parse(e.at)).filter(Number.isFinite));
      if (Date.now() - heard <= view.stale_after_minutes * 60_000) continue;
      // Nothing for that long: its window was shut, or its machine was. It is ended for it, as its end hook
      // would have ended it, what it held is given back, and its works_on closes, so it leaves its task's canvas.
      if (Date.now() - heard > endAfter * 60_000) {
        await sessionEnd(this.l, { kind: 'agent', name: 'pelago' }, { run: run.id, outcome: 'finished', reason: 'quiet', summary: `Not heard from for over ${hours} hours: ended for it` });
        continue;
      }
      const entity = await this.l.entity(run.id);
      if (entity?.props.stale_flagged) continue;
      await this.l.operational(run.id, { props: { stale_flagged: true } }, { actor: 'agent:pelago', action: 'run.stale', reason: `No report for over ${view.stale_after_minutes} minutes` });
      // Its tab on the owner's page goes until it next shows something (ui/tab-life.js); not while a turn is under way.
      if (!run.busy) await took((await bypassingRls(this.l)).db, this.l, { kind: 'other', actor: 'agent:pelago', did: 'quiet', rests: true, run: run.id }, true).catch(() => {});
      // Worth a person's attention only when it keeps something from everyone else: the rest end by themselves.
      if (!run.holds.length || !this.l.registry.type('notification')) continue;
      await notify(
        this.l,
        { kind: 'agent', name: 'pelago' },
        { title: `Session "${run.title}" has gone quiet`, body: `It still holds: ${run.holds.map((h) => h.title).join(', ')}. End it from its page to release them; left alone, it is ended after ${hours} hours.`, level: 'warning', about: run.id },
      );
    }
  }
}
