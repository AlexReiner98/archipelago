// Moved to packs/sessions/kernel/session-quiet.ts (docs/kernel-packs.md, "The shim"): the look for quiet sessions is
// the sessions pack's, on its context; what stays here is the timer that runs it while this server leads (started by
// src/open-steps.ts), since an optional pack has no timers.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/sessions/kernel/session-quiet.ts';

export * from '../packs/sessions/kernel/session-quiet.ts';

export class QuietSessions {
  readonly l: Archipelago;
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;

  constructor(l: Archipelago) {
    this.l = l;
  }

  start(everyMs = 30_000): void {
    // A failed pass from the timer is told to the owner (act.report.alert); one asked directly throws.
    this.timer = setInterval(() => void this.tick(moved.tick).catch((err) => console.error(`sessions: the look for quiet sessions failed: ${(err as Error).message}`)), everyMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** One pass: flag sessions gone quiet, and end those quiet for too long. */
  async tick(pass: (ctx: Parameters<typeof moved.tick>[0]) => Promise<void> = moved.flagStaleSessions): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await pass((await import('./kernel-context.ts')).ownContext(this.l, 'sessions'));
    } finally {
      this.busy = false;
    }
  }
}
