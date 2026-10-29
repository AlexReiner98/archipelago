// The kernel's own views that are not lenses: each reads what is kept to run the map (runs, notifications, the log,
// the styles and views kept) rather than a picture of the work, and src/operational.ts names each with its rule.
// Every picture of the work is a lens: a lens preset a pack declares (src/lens-presets.ts), asked by the same name.

import { type Entity, type Archipelago } from './pelago.ts';
import { spent } from './spent.ts';
import { factEvents } from './eventlog.ts';

/** The most change sets' events changed_since counts: past that, its counts are of the newest. */
const COUNTED = 20_000;
import { livesIn } from './places.ts';
import { savedViews } from './saved-views.ts'; import { pageStyle } from './styles.ts'; import { instructionsFor } from './instructions.ts';

/**
 * How kernel code asks a view a pack answers (a pack's read of another view). Handed in by src/askview.ts, which
 * needs these views itself; without a pack that answers, there is no answer.
 */
type PackAsker = (l: Archipelago, name: string, params: Record<string, unknown>) => Promise<unknown>;
let askPack: PackAsker | undefined;
export const setPackAsker = (asker: PackAsker) => void (askPack = asker); export const askPackView: PackAsker = (l, name, params) => (askPack ? askPack(l, name, params) : Promise.reject(new Error(`No view "${name}"`)));

async function changedSince(l: Archipelago, input: { since?: string; limit?: number }) {
  if (!input.since || Number.isNaN(Date.parse(input.since))) throw new Error('changed_since needs "since" as an ISO date or date-time');
  // The counts are of everything since; the events are the newest of them, few enough to read.
  const events = await l.events({ since: input.since, limit: input.limit ?? 50 });
  const { rows: kept } = await l.db.query<{ action: string; n: number }>(`select action, count(*)::int as n from event where ts >= $1::timestamptz group by action`, [input.since]);
  const counts = new Map(kept.map((r) => [r.action, r.n]));
  for (const ev of await factEvents(l.db, { since: input.since }, COUNTED)) counts.set(ev.action, (counts.get(ev.action) ?? 0) + 1);
  const rows = [...counts].map(([action, n]) => ({ action, n })).sort((a, b) => b.n - a.n);
  const total = rows.reduce((sum, r) => sum + r.n, 0);
  return {
    since: input.since,
    counts: Object.fromEntries(rows.map((r) => [r.action, r.n])),
    events,
    ...(total > events.length && { more: `The newest ${events.length} of ${total} events. Ask with a higher limit (500 at most) or a later since for the rest.` }),
  };
}

/** Minutes without a report before an open session is shown as stale. */
const STALE_MINUTES = 30;

async function sessions(l: Archipelago) {
  const runs = l.registry.family('run');
  const homes = livesIn(l);
  const { rows: open } = await l.db.query<Entity>(`select * from entity where type = any($1::text[]) and is_open and archived_at is null order by created_at desc`, [runs]);
  const { rows: links } = await l.db.query<{ run: string; type: string; id: string; title: string; entity_type: string }>(
    `select r.from_id as run, r.type, e.id, e.title, e.type as entity_type from relation r join entity e on e.id = r.to_id
     where r.from_id = any($1::text[]) and r.valid_to is null and r.type = any($2::text[])`,
    [open.map((r) => r.id), ['works_on', 'holds', ...homes]],
  );
  const { rows: ended } = await l.db.query(
    `select id, title, status, updated_at from entity where type = any($1::text[]) and not is_open and archived_at is null order by updated_at desc limit 10`,
    [runs],
  );
  const of = (run: string, ...types: string[]) => links.filter((x) => x.run === run && types.includes(x.type)).map(({ id, title, entity_type }) => ({ id, title, type: entity_type }));
  return {
    stale_after_minutes: STALE_MINUTES,
    open: open.map((r) => {
      const seen = (r.props.last_seen as string | undefined) ?? r.created_at.toISOString();
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        surface: r.props.surface,
        cwd: r.props.cwd,
        started: r.created_at,
        last_seen: seen,
        stale: Date.now() - Date.parse(seen) > STALE_MINUTES * 60_000,
        working_on: of(r.id, 'works_on'),
        holds: of(r.id, 'holds'),
        repo: of(r.id, ...homes)[0],
      };
    }),
    recently_ended: ended,
  };
}

async function notifications(l: Archipelago) {
  const { rows } = await l.db.query(
    `select n.id, n.title, n.body, n.props->>'level' as level, n.props->>'from' as from, n.created_at,
            a.id as about_id, a.title as about_title
     from entity n
     left join relation r on r.from_id = n.id and r.type = 'about' and r.valid_to is null
     left join entity a on a.id = r.to_id
     where n.type = any($1::text[]) and n.is_open and n.archived_at is null
     order by n.created_at desc limit 100`,
    [l.registry.family('notification')],
  );
  return rows;
}

export interface View {
  description: string;
  run(l: Archipelago, input: Record<string, unknown>): Promise<unknown>;
}

export const VIEWS: Record<string, View> = {
  changed_since: {
    description: 'What changed since a moment in time: how many events of each kind, and the newest of them. Long notes are cut to their start, and a change set says its reason once. Params: since (ISO date-time, required), limit (events listed, default 50; an agent is given the newest five unless it asks), full (true for everything whole).',
    run: changedSince,
  },
  spent: {
    description: 'What agents spent over the last days, read from their runs: dollars where a run says what it cost, tokens where it does not, by where they ran. The money pack\u2019s costs view adds what is paid regularly. Params: days (default 30).',
    run: spent,
  },
  notifications: {
    description: 'Unread notifications for the human, newest first.',
    run: notifications,
  },
  sessions: {
    description: 'Agent sessions and automation runs: what each open one is working on and holding, whether it has gone quiet, and the last ten that ended.',
    run: sessions,
  },
  saved_views: {
    description: 'Every view kept on the map (a lens, named by the style that draws it), with what it is a view of: pinned first, then the newest. Params: limit (100).',
    run: (l, input) => savedViews(l, input as { limit?: number }),
  },
  style: {
    description: 'How a page looks: the style of one item (the presets the packs ship, the workspace’s, its kind’s, its own, nearest last, a named set merged name by name), or with no item the workspace’s; and which styles went in (used). What an item page, the pages that are not views and the canvas are drawn by. Params: of (an item id), style (the id of one kept on the map, used outright), view (a view kept on the map: the styles kept about it too), have (the hashes of the drawings the page holds: then the style carries the drawing it names, its code left out when the page has it), try (a theme preset’s id: drawn as if the owner kept it, for this read only, nothing kept), `shape` (the form the reader chose for this view, as the view band’s switch names it: drawn in it, with its drawing, over every style).',
    run: (l, input) => pageStyle(l, input),
  },
  instructions: {
    description: 'What agents are told where: the instructions the packs ship (presets), under the workspace’s kept on the map, under those kept about a repository, nearest last, in order, each with the item (and preset) that says it. A session is told those for session_start when it begins. Params: for (where: session_start, working_rules, tool:<name>, or file:<path>, what is said about that file by the instructions whose file:<glob> names it; session_start unless said), about (a repository: what is said to a session there).',
    run: async (l, input) => ({ said: await instructionsFor(l, typeof input.for === 'string' ? input.for : 'session_start', { ...(typeof input.about === 'string' && { about: input.about }) }) }),
  },
};
