// One leader among the servers that share a database: it alone runs what runs on a clock (automations, pack
// schedules, re-checks, catch-up reads, backups), so two servers never fire the same thing twice. The others only
// answer requests.
//
// On a Postgres server the leader is whoever holds a session advisory lock on a connection of its own. The lock goes
// with the connection, so a leader that dies or loses the server lets it go, and a follower asking every few seconds
// takes over. A leader that loses its connection without dying notices on its next ping and stops: for at most one
// interval two may run. Behind a pooler in transaction mode a session lock means nothing: connect directly.
// With the database in a folder there is one server by construction (the data folder's lock), and it leads.

import pg from 'pg';

export interface Leader {
  readonly leading: boolean;
  /** Called each time this process becomes leader (true) or stops being it (false). */
  onChange(fn: (leading: boolean) => void): void;
  stop(): Promise<void>;
}

/** The only server there can be: it leads from the start. */
export function soleLeader(): Leader {
  return { leading: true, onChange: () => {}, stop: async () => {} };
}

/** Lead while holding the lock named `key` on the database at `url`, asking for it every `everyMs` until it is had. */
export async function pgLeader(url: string, { everyMs = 10_000, key = 'pelago.leader' } = {}): Promise<Leader> {
  let leading = false;
  let client: pg.Client | undefined;
  let stopped = false;
  const listeners: ((leading: boolean) => void)[] = [];
  const become = (now: boolean) => {
    if (now === leading) return;
    leading = now;
    for (const fn of listeners) fn(now);
  };
  const drop = () => {
    const c = client;
    client = undefined;
    become(false);
    void c?.end().catch(() => {});
  };
  let busy = false;
  const tick = async () => {
    // A tick still connecting when the next is due would open a second connection, which could take the lock unseen.
    if (busy || stopped) return;
    busy = true;
    try {
      if (!client) {
        const c = new pg.Client({ connectionString: url, keepAlive: true, query_timeout: Math.max(everyMs, 5000), application_name: 'pelago-leader' });
        c.on('error', () => client === c && drop());
        // A connection that failed, or that came up after stop, is ended here: nothing else knows of it.
        const up = await c.connect().then(() => !stopped, () => false);
        if (!up) return void c.end().catch(() => {});
        client = c;
      }
      // Asked again while held, the lock would only be counted twice: a leader asks only whether its connection lives.
      if (leading) await client.query('select 1');
      else if (!stopped) become(Boolean((await client.query<{ got: boolean }>(`select pg_try_advisory_lock(hashtext($1)) as got`, [key])).rows[0].got));
    } catch {
      drop();
    } finally {
      busy = false;
    }
  };
  await tick();
  const timer = setInterval(() => void tick(), everyMs);
  timer.unref();
  return {
    get leading() {
      return leading;
    },
    onChange: (fn) => void listeners.push(fn),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      const c = client;
      client = undefined;
      leading = false;
      await c?.end().catch(() => {}); // ending the connection lets the lock go
    },
  };
}
