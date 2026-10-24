// Automations: a trigger (a schedule or an event in the log) fires an action
// (a notification, a tool call or a session launch). Each automation is an
// entity in the map, so it is created through the normal write path: one an
// agent proposes does nothing until a human approves it. Every firing is
// logged with its result.

import { AUTOMATION_TOOLS, checkAutomation } from './automation-rules.ts';
import { lastSeq, readEvents } from './eventlog.ts';
import { launch } from './launcher.ts';
import type { Entity, Archipelago } from './pelago.ts';
import { notify } from './notify.ts';
import { sessionEnd } from './sessions.ts';
import { callTool } from './tools.ts';
import { VIEWS } from './views.ts';

interface LoggedEvent {
  seq: number;
  actor: string;
  action: string;
  target_id: string | null;
  target_title: string | null;
  reason: string;
}

const CURSOR = 'automation_cursor';

/** Hours without a word before an open session is taken to be gone, and ended for it. */
export const QUIET_HOURS = 12;

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (whole, key) => values[key] ?? whole);

const matches = (pattern: string, action: string) => (pattern.endsWith('*') ? action.startsWith(pattern.slice(0, -1)) : action === pattern);

export class Automations {
  readonly l: Archipelago;
  private timer: ReturnType<typeof setInterval> | undefined;
  private busy = false;

  constructor(l: Archipelago) {
    this.l = l;
  }

  start(everyMs = 30_000): void {
    this.timer = setInterval(() => void this.tick().catch((err) => console.error('automation tick failed:', err)), everyMs);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** One pass: flag sessions gone quiet, then fire whatever is due. Returns what fired. */
  async tick(now = new Date()): Promise<{ automation: string; ok: boolean; result: string }[]> {
    if (this.busy) return [];
    this.busy = true;
    try {
      await this.flagStaleSessions();
      const { rows: autos } = await this.l.db.query<Entity>(
        `select * from entity where type = any($1::text[]) and status = 'enabled' and archived_at is null order by created_at`,
        [this.l.registry.family('sys.automation')],
      );
      const events = await this.newEvents();
      const fired = [];
      for (const auto of autos) {
        const p = auto.props;
        if (p.action === 'launch' && (await this.stillRunning(auto))) continue;
        if (p.trigger === 'event') {
          const hits = events.filter((ev) => matches(p.on_action as string, ev.action));
          // One launch per pass however many events matched; a notification for each.
          for (const ev of p.action === 'launch' ? hits.slice(0, 1) : hits) fired.push(await this.fire(auto, now, ev));
        } else if (this.due(auto, now)) {
          fired.push(await this.fire(auto, now));
        }
      }
      return fired;
    } finally {
      this.busy = false;
    }
  }

  /** True while the session this automation last launched is still open. */
  private async stillRunning(auto: Entity): Promise<boolean> {
    const last = auto.props.last_run as string | undefined;
    return Boolean(last && (await this.l.entity(last))?.is_open);
  }

  private due(auto: Entity, now: Date): boolean {
    const last = auto.props.last_fired ? new Date(auto.props.last_fired as string) : undefined;
    if (auto.props.trigger === 'every') return !last || now.getTime() - last.getTime() >= (auto.props.every_minutes as number) * 60_000;
    if (auto.props.trigger === 'daily') {
      const [h, m] = (auto.props.at as string).split(':').map(Number);
      const slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m);
      return now >= slot && (!last || last < slot);
    }
    return false;
  }

  /** Events since the last pass. Nothing an automation did can trigger another, so they cannot loop. */
  private async newEvents(): Promise<LoggedEvent[]> {
    const cursor = await this.l.setting<number>(CURSOR);
    const latest = await lastSeq(this.l.db);
    await this.l.db.query(`insert into setting (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [CURSOR, JSON.stringify(latest)]);
    // First run: start from now instead of replaying the whole history.
    if (cursor === undefined) return [];
    const rows: LoggedEvent[] = [];
    for (let after = cursor; ; ) {
      const page = (await readEvents(this.l.db, { after, origin: 'pelago', news: true, oldest: true, limit: 500 })).filter((ev) => ev.seq <= latest);
      rows.push(...page.filter((ev) => !ev.actor.includes(':automation:') && ev.action !== 'automation.fire'));
      if (page.length < 500) return rows;
      after = page.at(-1)!.seq;
    }
  }

  private async fire(auto: Entity, now: Date, ev?: LoggedEvent) {
    const p = auto.props;
    const input = (p.input ?? {}) as Record<string, unknown>;
    const name = `automation:${auto.id}`;
    let ok = true;
    let result: string;
    try {
      const problems = checkAutomation(p);
      if (problems.length) throw new Error(problems.join('; '));
      if (p.action === 'notify') {
        const values = { title: auto.title, action: ev?.action ?? '', actor: ev?.actor ?? '', target: ev?.target_title ?? '', reason: ev?.reason ?? '' };
        const done = await notify(this.l, { kind: 'agent', name }, { title: fill((p.message as string) || auto.title, values), level: p.level as 'info', about: ev?.target_id ?? undefined });
        result = `notified (${done.notification})`;
      } else if (p.action === 'tool') {
        if (!AUTOMATION_TOOLS.includes(p.tool as string)) throw new Error(`tool "${p.tool}" is not allowed in automations`);
        // What an automation changes by itself waits for the owner, whatever agents may do here: no one asked for it just now.
        result = JSON.stringify(await callTool(this.l, { kind: 'agent', name, may: 'propose' }, p.tool as string, input)).slice(0, 500);
      } else {
        // A human approved this automation, launch settings included, so it may launch.
        // The session it starts only proposes, and its run names the automation.
        const started = await launch(this.l, { kind: 'human', name }, { task: input.task as string, mode: input.mode as 'plan', instructions: input.instructions as string | undefined }, { kind: 'automation', id: auto.id, name: auto.title });
        await this.l.operational(auto.id, { props: { last_run: started.run } });
        result = `launched run ${started.run} (${started.mode})`;
      }
    } catch (err) {
      ok = false;
      result = (err as Error).message;
    }
    // Bookkeeping stays out of the entity's history; the firing itself is the event.
    await this.l.operational(
      auto.id,
      { props: { last_fired: now.toISOString(), last_result: `${ok ? 'ok' : 'failed'}: ${result}`.slice(0, 500) } },
      { actor: `agent:${name}`, action: 'automation.fire', reason: ev ? `Triggered by ${ev.action}` : `Scheduled (${p.trigger})`, detail: { ok, result, trigger_event: ev?.seq } },
    );
    return { automation: auto.id, ok, result };
  }

  /** Tell the human, once, about each open session that has stopped reporting. */
  private async flagStaleSessions(): Promise<void> {
    if (!this.l.registry.type('sys.notification')) return;
    const view = (await VIEWS.sessions.run(this.l, {})) as { stale_after_minutes: number; open: { id: string; title: string; stale: boolean; last_seen: string; holds: { title: string }[] }[] };
    for (const run of view.open.filter((r) => r.stale)) {
      // Half a day without a word: its window was shut, or its machine was. It is ended for it, as its end hook
      // would have ended it, and what it held is given back.
      if (Date.now() - Date.parse(run.last_seen) > QUIET_HOURS * 3_600_000) {
        await sessionEnd(this.l, { kind: 'agent', name: 'pelago' }, { run: run.id, outcome: 'finished', summary: `Not heard from for over ${QUIET_HOURS} hours: ended for it` });
        continue;
      }
      const entity = await this.l.entity(run.id);
      if (entity?.props.stale_flagged) continue;
      await this.l.operational(run.id, { props: { stale_flagged: true } }, { actor: 'agent:pelago', action: 'run.stale', reason: `No report for over ${view.stale_after_minutes} minutes` });
      // Worth a person's attention only when it keeps something from everyone else: the rest end by themselves.
      if (!run.holds.length) continue;
      await notify(
        this.l,
        { kind: 'agent', name: 'pelago' },
        { title: `Session "${run.title}" has gone quiet`, body: `It still holds: ${run.holds.map((h) => h.title).join(', ')}. End it from its page to release them; left alone, it is ended after ${QUIET_HOURS} hours.`, level: 'warning', about: run.id },
      );
    }
  }
}
