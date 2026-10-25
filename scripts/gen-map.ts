// A year-three map for a team of ten with agents, generated from a seed, for timing the views at scale:
//   node --max-old-space-size=8192 scripts/gen-map.ts <new data folder | postgres://.../empty database> [--events 10000000] [--seed 1] [--days 1095] [--end ISO]
// The same seed and size make the same map: the same ids, titles, links and log, shifted to end at --end (the
// hour it is run, unless given). What it holds, at 10 million events: about 300,000 items that are facts about the
// work (projects, tasks, decisions, notes, documents, issues, features, pull requests, sources) with their part_of
// trees, depends_on chains, waits_on and about links, a fifth of the log; and the rest operational, as a team with
// agents writes it: agent runs with their stories and links, notifications and their reading, claims and releases of
// resources, pushes heard from GitHub, readings of components by a monitor, and tool calls imported from connections.
//
// Written in bulk, not through change: the write path stamps every row with now() and would take hours at this size.
// The rows are those the write path writes (the same columns, kinds, event actions and detail), so the server opens
// the map as its own; the bench then writes, holds, approves and undoes through the real path on top of it.
// Run it with no server on the database. It refuses one that already holds items.

import { readdirSync, readFileSync } from 'node:fs';
import { openDb } from '../src/db.ts';
import { regatherAll } from '../src/closure.ts';
import { mentionedAll } from '../src/mentions.ts';

const args = process.argv.slice(2);
const opt = (name: string, dflt: string) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : dflt);
const where = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!where) throw new Error('Name a new data folder or an empty postgres:// database to fill.');
const EVENTS = Number(opt('events', '10000000'));
const SEED = Number(opt('seed', '1'));
const DAYS = Number(opt('days', '1095'));
const END = new Date(opt('end', new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString())).getTime();
const DAY = 86_400_000;
const START = END - DAYS * DAY;
// Rates below are per day at full size, which comes to about 11 million events over 1,095 days: scaled to --events.
const SCALE = (EVENTS / 11_000_000) * (1095 / DAYS);

// ---- chance, from the seed alone (sfc32) ----
let [a, b, c, d] = [0x9e3779b9 ^ SEED, 0x243f6a88, 0xb7e15162, SEED >>> 0];
const R = () => {
  a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
  const t = (a + b) | 0;
  a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0;
  const r = (t + d) | 0;
  c = (c + r) | 0;
  return (r >>> 0) / 4294967296;
};
for (let i = 0; i < 20; i++) R();
const int = (n: number) => Math.floor(R() * n);
const pick = <T>(xs: T[]): T => xs[int(xs.length)];
const chance = (p: number) => R() < p;
const count = (mean: number) => Math.floor(mean) + (R() < mean % 1 ? 1 : 0);
const expo = (mean: number) => -Math.log(1 - R()) * mean;
const weighted = <T extends string>(w: Record<T, number>): T => {
  let x = R() * Object.values<number>(w).reduce((s, v) => s + v, 0);
  for (const [k, v] of Object.entries<number>(w)) if ((x -= v) < 0) return k as T;
  return Object.keys(w)[0] as T;
};

// Ids as the server makes them (src/db.ts newId), but each a step of a permutation of the id space: unique, and the same for the same seed.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const SPACE = 31n ** 8n;
const made: Record<string, bigint> = {};
const newId = (prefix: string) => {
  made[prefix] = (made[prefix] ?? 0n) + 1n;
  let n = (made[prefix] * 1_000_000_007n + BigInt(SEED) * 7_919n + BigInt(prefix.charCodeAt(0)) * 104_729n) % SPACE;
  let out = '';
  for (let i = 0; i < 8; i++, n /= 31n) out += ALPHABET[Number(n % 31n)];
  return `${prefix}_${out}`;
};

// ---- words ----
const NOUNS = 'roof wall sun model export render review site sheet grid shadow facade budget client permit schedule survey zoning daylight mesh plugin parser index cache login invoice report window stair core slab beam column level view legend title block layer family sync upload backup token search lens flow graph tree roadmap release build test result proof bug note session story hub style drawing screen pack rule change link field kind type folder query plan cost estimate tender drawing-set elevation section detail'.split(' ');
const VERBS = 'Fix Add Move Check Draw Split Merge Measure Speed up Settle Decide Write Read Name Show Hide Cut Keep Test Ship Find'.split(' ');
const OPENERS = ['The point is that', 'We found that', 'It turns out', 'The owner asked that', 'Agreed with the client:', 'For the next release,', 'Measured today:', 'Until this lands,'];
const word = () => pick(NOUNS);
const title = () => `${pick(VERBS)} the ${word()} ${word()}`;
const sentence = () => `${pick(OPENERS)} the ${word()} of the ${word()} ${pick(['waits on', 'follows from', 'breaks', 'needs', 'reads', 'replaces'])} the ${word()} ${word()}.`;
const prose = (n: number) => Array.from({ length: n }, sentence).join(' ');
const sections = (n: number) => [prose(2), ...Array.from({ length: n }, () => `## The ${word()} ${word()}\n${prose(3 + int(4))}`)].join('\n\n');
const PEOPLE = ['Ana Moreau', 'Ben Okafor', 'Chen Wei', 'Dana Kovacs', 'Eli Brandt', 'Femi Adeyemi', 'Gus Lindqvist', 'Hana Sato', 'Ivo Petrov', 'Jo Rivera'];
const TOOLS = ['Read', 'Edit', 'Bash', 'Grep', 'Glob', 'Write', 'mcp__pelago__view', 'mcp__pelago__change', 'mcp__pelago__get', 'mcp__pelago__search', 'WebFetch', 'TodoWrite'];

// ---- the types the packs declare, and the kind of each (as the database's trigger would fill it) ----
const defs = new Map<string, { extends?: string; kind?: boolean }>();
for (const pack of readdirSync(new URL('../packs/', import.meta.url))) {
  try {
    for (const t of JSON.parse(readFileSync(new URL(`../packs/${pack}/pack.json`, import.meta.url), 'utf8')).types ?? []) defs.set(t.id, t);
  } catch {}
}
const kindOf = (type: string): string => {
  const t = defs.get(type);
  if (!t) throw new Error(`No pack declares ${type}`);
  return t.kind || !t.extends ? type : kindOf(t.extends);
};

// ---- buffers, written in bulk as each fills: items before the links that point at them ----
type Row = unknown[];
const COLUMNS: Record<string, [string, string, string?][]> = {
  entity: [['id', 'text'], ['type', 'text'], ['kind', 'text'], ['title', 'text'], ['body', 'text'], ['status', 'text'], ['is_open', 'bool'], ['owner', 'text'], ['visibility', 'text'], ['private_to', 'text'], ['props', 'text', 'jsonb'], ['source_id', 'text'], ['created_at', 'text', 'timestamptz'], ['updated_at', 'text', 'timestamptz'], ['archived_at', 'text', 'timestamptz']],
  relation: [['id', 'text'], ['type', 'text'], ['from_id', 'text'], ['to_id', 'text'], ['props', 'text', 'jsonb'], ['valid_from', 'text', 'timestamptz'], ['valid_to', 'text', 'timestamptz']],
  proposal: [['id', 'text'], ['ts', 'text', 'timestamptz'], ['actor', 'text'], ['reason', 'text'], ['ops', 'text', 'jsonb'], ['status', 'text'], ['decided_by', 'text'], ['decided_at', 'text', 'timestamptz'], ['private_to', 'text'], ['held_by', 'text', 'jsonb']],
  event: [['ts', 'text', 'timestamptz'], ['origin', 'text'], ['actor', 'text'], ['action', 'text'], ['target_id', 'text'], ['changeset', 'text'], ['reason', 'text'], ['detail', 'text', 'jsonb'], ['private_to', 'text']],
};
const buffers: Record<string, Row[]> = { entity: [], relation: [], proposal: [], event: [] };
const written: Record<string, number> = { entity: 0, relation: 0, proposal: 0, event: 0 };
const BATCH = 20_000;
const db = await openDb(where);
if ((await db.query<{ n: number }>(`select count(*)::int as n from entity`)).rows[0].n) throw new Error(`${where} already holds items: generate into a new one.`);

async function flush(all = false) {
  for (const table of ['entity', 'relation', 'proposal', 'event']) {
    const rows = buffers[table];
    if (!rows.length || (!all && table === 'event' && rows.length < BATCH)) continue;
    const cols = COLUMNS[table];
    const names = cols.map((c) => c[0]).join(', ');
    await db.query(
      `insert into ${table} (${names}) select ${cols.map((c) => (c[2] ? `${c[0]}::${c[2]}` : c[0])).join(', ')}
       from unnest(${cols.map((c, i) => `$${i + 1}::${c[1]}[]`).join(', ')}) with ordinality as u(${names}, ord) order by ord`,
      cols.map((_, i) => rows.map((r) => r[i])),
    );
    written[table] += rows.length;
    buffers[table] = [];
  }
}
const iso = (ms: number) => new Date(ms).toISOString();
const json = (v: unknown) => JSON.stringify(v);

// ---- what is on the map ----
interface Item { id: string; type: string; title: string; private_to: string | null }
const items: Item[] = [];
const person: Item[] = [];
const repos: Item[] = [];
const resources: Item[] = [];
const connections: Item[] = [];
const components: (Item & { status: string; at: number })[] = [];
const projects: { item: Item; until: number }[] = [];
const recentTasks: Item[] = [];
const recentFeatures: Item[] = [];
const recentRuns: Item[] = [];
const owner = () => pick(person);
const humanActor = (p: Item) => (p === person[0] ? 'human:owner' : `human:${p.id}`);

function entity(type: string, title: string, body: string, status: string, open: boolean, at: number, extra: { owner?: string; private_to?: string | null; props?: object; source?: string; updated?: number; archived?: number } = {}): Item {
  const item = { id: newId('e'), type, title, private_to: extra.private_to ?? null };
  buffers.entity.push([item.id, type, kindOf(type), title, body, status, open, extra.owner ?? null, item.private_to ? 'private' : 'shared', item.private_to, json(extra.props ?? {}), extra.source ?? null, iso(at), iso(extra.updated ?? at), extra.archived ? iso(extra.archived) : null]);
  return item;
}

// The log of one day, in order of time once the day is over.
type Ev = [number, string, string, string, string | null, string | null, string, object, string | null];
let day: Ev[] = [];
const later: Ev[][] = Array.from({ length: DAYS + 1 }, () => []);
const log = (ts: number, actor: string, action: string, target: string | null, changeset: string | null, reason: string, detail: object, origin = 'pelago', privateTo: string | null = null) => {
  const e: Ev = [ts, origin, actor, action, target, changeset, reason, detail, privateTo];
  const at = Math.floor((ts - START) / DAY);
  if (ts > END) return false;
  (at <= today ? day : later[at]).push(e);
  return true;
};
let today = 0;
function link(type: string, from: Item, to: Item, at: number, actor: string, changeset: string | null, reason: string, opts: { props?: object; until?: number; authority?: object } = {}) {
  const id = newId('r');
  const until = opts.until !== undefined && opts.until <= END ? opts.until : null;
  buffers.relation.push([id, type, from.id, to.id, json(opts.props ?? {}), iso(at), until ? iso(until) : null]);
  log(at, actor, 'relation.link', from.id, changeset, reason, { to: to.id, type, relation: id, ...opts.props && { props: opts.props }, ...opts.authority && { authority: opts.authority } });
  if (until) log(until, actor, 'relation.unlink', from.id, newId('c'), `The ${type} no longer holds`, { to: to.id, type, relation: id });
}
// A moment in the day: people mostly in working hours, agents at any hour.
const moment = (dayIndex: number, human = false) => START + dayIndex * DAY + (human || chance(0.7) ? 8 + R() * 11 : R() * 24) * 3_600_000;
const growth = (dayIndex: number) => (0.5 + dayIndex / DAYS) * ((dayIndex + 3) % 7 < 2 ? 0.45 : 1.22) * SCALE;

// ---- day 0: the people, repositories, resources and connections ----
{
  const t = START + 9 * 3_600_000;
  const cs = newId('c');
  for (const name of PEOPLE) {
    const p = entity('person', name, '', 'active', true, t, { props: { email: `${name.split(' ')[0].toLowerCase()}@example.com`, role: pick(['architect', 'engineer', 'developer', 'designer']) } });
    person.push(p);
    log(t, 'human:owner', 'entity.create', p.id, cs, 'The team', { type: 'person', title: name, status: 'active' });
  }
  for (let i = 0; i < 25; i++) {
    const r = entity('software.repo', `${word()}-${word()}`, prose(1), 'active', true, t, { props: { remote: `github.com/team/${word()}-${i}`, default_branch: 'main' } });
    repos.push(r);
    log(t, 'human:owner', 'entity.create', r.id, cs, 'The repositories', { type: 'software.repo', title: r.title, status: 'active' });
  }
  for (let i = 0; i < 30; i++) {
    const r = entity('resource', `The ${word()} ${pick(['licence', 'machine', 'staging site', 'render node'])} ${i}`, '', 'available', true, t, { props: { exclusive: true } });
    resources.push(r);
    log(t, 'human:owner', 'entity.create', r.id, cs, 'What is shared', { type: 'resource', title: r.title, status: 'available' });
  }
  for (const p of person.concat(person.slice(0, 2))) {
    const c = entity('sys.connection', `${p.title.split(' ')[0]}'s Claude Code`, '', 'available', true, t, { props: { audit_log: `~/.claude/audit-${p.id}.jsonl` } });
    connections.push(c);
    log(t, humanActor(p), 'entity.create', c.id, cs, 'A connection', { type: 'sys.connection', title: c.title, status: 'available' });
  }
  for (let i = 0; i < 300; i++) components.push({ id: newId('e'), type: 'software.component', title: `${word()} ${pick(['service', 'worker', 'store', 'queue', 'site'])} ${i}`, private_to: null, status: 'up', at: t });
}

// ---- the facts: items made in change sets by people and agents, each with the life it will have ----
const FACT_TYPES = { 'work.task': 600, 'work.note': 70, 'work.decision': 40, 'work.issue': 25, 'software.bug': 25, 'work.document': 30, 'software.feature': 25, 'work.idea': 20, 'work.meeting': 10, 'sys.source': 80, 'software.pull_request': 50, 'work.project': 2.4 };
const LIFE: Record<string, { open: string[]; closed: string[]; updates: number; closes: number }> = {
  'work.task': { open: ['todo', 'doing'], closed: ['done', 'done', 'done', 'dropped'], updates: 3, closes: 0.92 },
  'work.issue': { open: ['open', 'investigating'], closed: ['resolved', 'resolved', 'wontfix'], updates: 3, closes: 0.85 },
  'software.bug': { open: ['open', 'investigating'], closed: ['resolved', 'resolved', 'wontfix'], updates: 3, closes: 0.85 },
  'software.feature': { open: ['planned', 'building'], closed: ['shipped', 'shipped', 'dropped'], updates: 5, closes: 0.8 },
  'software.pull_request': { open: ['open'], closed: ['merged', 'merged', 'merged', 'closed'], updates: 2, closes: 0.97 },
  'work.decision': { open: ['open'], closed: ['decided'], updates: 2, closes: 0.8 },
  'work.idea': { open: ['raw', 'exploring'], closed: ['adopted', 'dropped'], updates: 1, closes: 0.5 },
  'work.project': { open: ['planned', 'active'], closed: ['done', 'done', 'dropped'], updates: 8, closes: 0.6 },
  'work.note': { open: ['current'], closed: ['stale'], updates: 2, closes: 0.1 },
  'work.document': { open: ['draft', 'ready'], closed: ['superseded'], updates: 4, closes: 0.15 },
  'work.meeting': { open: ['upcoming'], closed: ['happened'], updates: 1, closes: 0.95 },
  'sys.source': { open: ['recorded'], closed: ['removed'], updates: 0, closes: 0 },
};
const authorityOf = (actor: string, p: Item) => (actor.startsWith('agent:') ? { of: 'agent', who: actor, basis: sentence() } : { of: 'human', who: actor, basis: `${p.title} in the web UI` });

function makeFact(type: string, at: number, actor: string, by: Item, cs: string, reason: string, source?: Item) {
  const life = LIFE[type];
  const isProject = type === 'work.project';
  const body = type === 'work.document' ? sections(3 + int(5)) : type === 'work.note' ? sections(1 + int(3)) : type === 'sys.source' ? sentence() : prose(1 + int(3));
  // Its changes to come: each some days after the one before, the last closing it when it closes.
  const steps: number[] = [];
  let t = at;
  for (let n = count(life.updates * (0.5 + R())); n > 0; n--) steps.push((t += expo(isProject ? 60 : 9) * DAY));
  const closes = steps.length > 0 && chance(life.closes) && steps.at(-1)! <= END;
  const shown = steps.filter((s) => s <= END);
  const status = closes ? pick(life.closed) : shown.length ? life.open.at(-1)! : life.open[0];
  const archived = chance(0.02) ? at + expo(120) * DAY : undefined;
  const props = type === 'work.decision' && closes ? { outcome: sentence(), rationale: sentence() } : type === 'work.task' && chance(0.2) ? { due: iso(at + expo(20) * DAY).slice(0, 10), priority: pick(['high', 'medium', 'low']) } : {};
  const item = entity(type, isProject ? `${word()[0].toUpperCase()}${word().slice(1)} ${word()} project` : type === 'sys.source' ? `${by.title}, ${iso(at).slice(0, 10)}: ${word()} ${word()}` : title(), body, status, !closes, at, {
    owner: chance(0.4) ? by.id : undefined, private_to: chance(0.12) ? by.id : null, props, source: source?.id, updated: shown.at(-1) ?? at, archived: archived && archived <= END ? archived : undefined,
  });
  items.push(item);
  log(at, actor, 'entity.create', item.id, cs, reason, { type, title: item.title, status: life.open[0], authority: authorityOf(actor, by) });
  let from = life.open[0];
  for (const [i, s] of shown.entries()) {
    const last = i === shown.length - 1;
    const to = last ? status : life.open[Math.min(i + 1, life.open.length - 1)];
    const who = chance(0.6) ? `agent:claude-code/claude-code:${word()}-${word()}` : humanActor(owner());
    const changes = to !== from ? { status: { from, to } } : chance(0.5) ? { body: { appended: 80 + int(400) } } : { props: { due: { from: null, to: iso(s + 10 * DAY).slice(0, 10) } } };
    log(s, who, 'entity.update', item.id, newId('c'), last && closes ? `Done: ${sentence()}` : sentence(), { title: item.title, changes, authority: authorityOf(who, by) });
    from = to;
  }
  if (archived && archived <= END) log(archived, humanActor(owner()), chance(0.2) ? 'entity.merge' : 'entity.archive', item.id, newId('c'), 'Not needed any more', { title: item.title });
  return item;
}

function factChangeset(dayIndex: number) {
  const by = owner();
  const human = chance(0.3);
  const at = moment(dayIndex, human);
  const actor = human ? humanActor(by) : `agent:claude-code/claude-code:${word()}-${word()}-${int(1e6).toString(36)}`;
  const cs = newId('c');
  const reason = prose(1 + int(2));
  const source = chance(0.3) ? makeFact('sys.source', at, actor, by, cs, 'Source of this change') : undefined;
  for (let n = 1 + count(expo(2.5)); n > 0; n--) {
    const type = weighted(FACT_TYPES);
    if (type === 'sys.source') continue;
    const item = makeFact(type, at, actor, by, cs, reason, source);
    const authority = authorityOf(actor, by);
    const project = projects.length ? pick(projects.filter((p) => p.until > at).slice(-60).concat(projects.slice(-5))).item : undefined;
    const unlinked = () => (chance(0.06) ? at + expo(30) * DAY : undefined);
    if (type === 'work.project') {
      if (project && chance(0.15)) link('part_of', item, project, at, actor, cs, reason, { authority });
      if (chance(0.3)) link('software.lives_in', item, pick(repos), at, actor, cs, reason, { authority });
      projects.push({ item, until: at + (60 + expo(300)) * DAY });
      continue;
    }
    if (type === 'work.task') {
      const parent = chance(0.2) && recentTasks.length ? pick(recentTasks) : project;
      if (parent) link('part_of', item, parent, at, actor, cs, reason, { authority, until: unlinked() });
      if (recentTasks.length && chance(0.3)) link('depends_on', item, pick(recentTasks.slice(-400)), at, actor, cs, reason, { authority, until: unlinked() });
      if (chance(0.03)) link('waits_on', item, pick(person), at, actor, cs, reason, { authority, props: { for: `An answer on the ${word()}` }, until: at + expo(6) * DAY });
      recentTasks.push(item);
      if (recentTasks.length > 3000) recentTasks.splice(0, 1000);
    } else if (project) link('part_of', item, project, at, actor, cs, reason, { authority, until: unlinked() });
    if (['work.document', 'work.decision', 'work.note'].includes(type) && recentTasks.length && chance(0.5)) link('about', item, pick(recentTasks), at, actor, cs, reason, { authority });
    if (type === 'software.feature') recentFeatures.push(item);
    if (type === 'software.pull_request' && recentTasks.length) link('relates_to', item, pick(recentTasks.slice(-200)), at, actor, cs, reason, { authority });
  }
}

// A release every few weeks: what it waits for (depends_on recent work) and the features it ships.
function release(dayIndex: number) {
  const by = owner();
  const at = moment(dayIndex, true);
  const actor = humanActor(by);
  const cs = newId('c');
  const happens = at + expo(20) * DAY;
  const item = entity('software.release', `Release ${int(9)}.${int(30)}`, prose(1), happens <= END ? 'happened' : 'upcoming', happens > END, at, { props: { version: `${int(9)}.${int(30)}.0`, at: iso(happens).slice(0, 10) }, updated: Math.min(happens, END) });
  log(at, actor, 'entity.create', item.id, cs, 'The next release', { type: 'software.release', title: item.title, status: 'upcoming' });
  for (let n = 5 + int(25); n > 0 && recentTasks.length; n--) link('depends_on', item, pick(recentTasks.slice(-300)), at, actor, cs, 'What it waits for');
  for (let n = 1 + int(4); n > 0 && recentFeatures.length; n--) link('ships', item, pick(recentFeatures.slice(-40)), at, actor, cs, 'What it ships');
  if (happens <= END) log(happens, actor, 'entity.update', item.id, newId('c'), 'Released', { title: item.title, changes: { status: { from: 'upcoming', to: 'happened' } } });
}

// ---- the operational: runs, notifications, claims, pushes, readings and imported tool calls ----
function run(dayIndex: number) {
  const p = owner();
  const at = moment(dayIndex);
  const actor = `agent:claude-code/claude-code:${word()}-${int(36 ** 6).toString(36)}`;
  const task = recentTasks.length ? pick(recentTasks.slice(-600)) : undefined;
  const ends = at + expo(40) * 60_000;
  const open = ends > END;
  const status = open ? 'running' : weighted({ finished: 90, failed: 5, cancelled: 5 });
  const story = Array.from({ length: count(expo(4)) }, (_, n) => ({ n: n + 1, at: iso(at + (n + 1) * 120_000), said: prose(1), about: task ? [task.id] : [], links: [], ...(chance(0.2) && { finding: true }) }));
  const tokens = Math.round(expo(120_000));
  const item = entity('sys.run', task?.title ?? `Session ${word()} ${word()}`, '', status, open, at, {
    private_to: p.id, updated: Math.min(ends, END),
    props: { surface: 'claude-code', session_id: newId('s'), branch: `claude/${word()}-${word()}`, cwd: `/work/${word()}`, started_by: humanActor(p), last_seen: iso(Math.min(ends, END)), tokens_used: tokens, cost_usd: Math.round(tokens * 0.0009) / 100, turns: 1 + int(80), active: open, story },
  });
  const cs = newId('c');
  log(at, actor, 'entity.create', item.id, cs, 'Session started', { type: 'sys.run', title: item.title, status: 'running' });
  if (task) link('sys.works_on', item, task, at, actor, cs, 'Session started');
  link('software.lives_in', item, pick(repos), at, actor, cs, 'Session started');
  if (chance(0.3)) {
    const resource = pick(resources);
    const until = at + expo(25) * 60_000;
    buffers.relation.push([newId('r'), 'holds', item.id, resource.id, json(task ? { for: task.id } : {}), iso(at), until <= END ? iso(until) : null]);
    log(at + 1000, actor, 'resource.claim', resource.id, null, `Working on ${item.title}`, { resource: resource.title, holder: item.id, holder_title: item.title, for: task?.id });
    log(until, actor, 'resource.release', resource.id, null, 'Done with it', { holder: item.id });
  }
  if (!open && chance(0.1)) log(ends - 60_000, 'system', 'run.stale', item.id, null, 'Gone quiet', { title: item.title });
  if (!open) log(ends, actor, 'entity.update', item.id, newId('c'), 'Session ended', { title: item.title, changes: { status: { from: 'running', to: status } } });
  recentRuns.push(item);
  if (recentRuns.length > 2000) recentRuns.splice(0, 1000);
}

function notification(dayIndex: number) {
  const p = owner();
  const at = moment(dayIndex);
  const read = at + expo(1.5) * DAY;
  const isRead = chance(0.85) && read <= END;
  const from = recentRuns.length && chance(0.7) ? `agent:claude-code/claude-code:${word()}` : 'system';
  const item = entity('sys.notification', `${pick(['Waiting on you:', 'Done:', 'Blocked:', 'Gone quiet:', 'Pushed:'])} ${title()}`, prose(1), isRead ? 'read' : 'unread', !isRead, at, { private_to: p.id, updated: isRead ? read : at, props: { level: weighted({ info: 80, warning: 18, error: 2 }), from } });
  const cs = newId('c');
  log(at, from, 'entity.create', item.id, cs, 'Notification', { type: 'sys.notification', title: item.title, status: 'unread' });
  if (recentTasks.length && chance(0.7)) link('about', item, pick(recentTasks.slice(-1000)), at, from, cs, 'Notification');
  if (isRead) log(read, humanActor(p), 'entity.update', item.id, newId('c'), 'Read', { title: item.title, changes: { status: { from: 'unread', to: 'read' } } });
}

function push(dayIndex: number) {
  const repo = pick(repos);
  const at = moment(dayIndex, true);
  const branch = chance(0.4) ? 'main' : `claude/${word()}-${word()}`;
  const commits = Array.from({ length: 1 + count(expo(1.5)) }, () => ({ sha: int(16 ** 7).toString(16).padStart(7, '0'), subject: title(), url: `https://github.com/team/${repo.title}/commit/x`, author: pick(PEOPLE) }));
  log(at, 'github', 'repo.push', repo.id, null, `${commits.length} commit${commits.length === 1 ? '' : 's'} to ${branch}: ${commits.at(-1)!.subject}`, { repo: `team/${repo.title}`, pusher: pick(PEOPLE), delivery: newId('d'), branch, default_branch: branch === 'main', before: commits[0].sha, after: commits.at(-1)!.sha, commits }, 'github');
}

function reading(dayIndex: number) {
  const c = pick(components);
  const at = moment(dayIndex);
  const to = c.status === 'up' ? weighted({ up: 70, degraded: 25, down: 5 }) : weighted({ up: 80, degraded: 15, down: 5 });
  const changes = to !== c.status ? { status: { from: c.status, to } } : { props: { commit: { from: null, to: int(16 ** 7).toString(16) } } };
  log(at, 'agent:monitor', 'entity.update', c.id, null, `Read from ${c.title}`, { title: c.title, changes });
  c.status = to;
  c.at = Math.max(c.at, at);
}

function toolCall(dayIndex: number) {
  const conn = pick(connections);
  const tool = pick(TOOLS);
  log(moment(dayIndex), `external:${conn.title}`, tool, conn.id, null, '', { params: { [tool.startsWith('mcp') ? 'name' : 'path']: `/work/${word()}/${word()}.ts`, ...(chance(0.3) && { pattern: `${word()}|${word()}` }) }, durationMs: Math.round(expo(800)), ok: chance(0.96) }, 'external');
}

// A batch of tool calls read from a connection's log is itself logged, as one import.
const imported = (dayIndex: number) => log(moment(dayIndex), 'agent:pelago', 'audit.import', pick(connections).id, null, '', { imported: 1 + int(40), path: '~/.claude/audit.jsonl' });

function proposal(dayIndex: number) {
  const p = owner();
  const at = moment(dayIndex);
  const actor = `agent:claude-code/claude-code:${word()}-${word()}`;
  const decided = at + expo(1.2) * DAY;
  const status = decided > END ? 'pending' : weighted({ approved: 70, rejected: 25, superseded: 5 });
  const id = newId('p');
  const reason = prose(1);
  const ops = Array.from({ length: 1 + int(4) }, () => (recentTasks.length && chance(0.6) ? { op: 'update', id: pick(recentTasks).id, append: sentence() } : { op: 'create', ref: `n${int(9)}`, type: 'work.task', title: title() }));
  buffers.proposal.push([id, iso(at), actor, reason, json(ops), status, status === 'pending' ? null : status === 'superseded' ? 'agent:pelago' : humanActor(p), status === 'pending' ? null : iso(decided), null, json({ rule: 'agent_changes' })]);
  log(at, actor, 'proposal.create', null, null, reason, { proposal: id, ops: ops.length, held_by: 'agent_changes' }, 'pelago', p.id);
  if (status !== 'pending') log(decided, status === 'superseded' ? 'agent:pelago' : humanActor(p), `proposal.${status === 'approved' ? 'approve' : status === 'rejected' ? 'reject' : 'supersede'}`, null, null, reason, { proposal: id, proposed_by: actor }, 'pelago', p.id);
}

// ---- three years, a day at a time ----
const RATES: [number, (d: number) => void][] = [[155, factChangeset], [300, run], [550, notification], [100, push], [1500, reading], [2900, toolCall], [150, imported], [25, proposal], [0.08, release]];
const t0 = performance.now();
for (today = 0; today < DAYS; today++) {
  const g = growth(today);
  if (today === 0) for (let i = 0; i < 40; i++) projects.push({ item: makeFact('work.project', START + 9 * 3_600_000, 'human:owner', person[0], newId('c'), 'The projects we start with'), until: END + DAY });
  for (const [rate, make] of RATES) for (let n = count(rate * g); n > 0; n--) make(today);
  if (today === DAYS - 1) release(today); // one still to come, whatever the size
  day.push(...later[today]);
  later[today] = [];
  day.sort((x, y) => x[0] - y[0]);
  for (const e of day) buffers.event.push([iso(e[0]), e[1], e[2], e[3], e[4], e[5], e[6], json(e[7]), e[8]]);
  day = [];
  if (buffers.entity.length >= BATCH || buffers.relation.length >= BATCH || buffers.event.length >= BATCH) await flush();
  if (today % 50 === 0) process.stderr.write(`day ${today}/${DAYS}: ${written.event.toLocaleString()} events, ${written.entity.toLocaleString()} items, ${((performance.now() - t0) / 1000).toFixed(0)} s\n`);
}
// The components, as their last readings left them; the owner; and the log's last events.
for (const c of components) buffers.entity.push([c.id, c.type, kindOf(c.type), c.title, '', c.status, true, null, 'shared', null, '{}', null, iso(START), iso(c.at), null]);
await flush(true);
await db.query(`insert into setting (key, value) values ('me', $1::jsonb) on conflict (key) do update set value = excluded.value`, [json(person[0].id)]);
// What the projector keeps beside the rows (src/closure.ts, src/mentions.ts), made whole from them as a restore does.
process.stderr.write('projecting what is inside what, and what names what\n');
await regatherAll(db, ['part_of']);
await mentionedAll(db);
process.stderr.write('analysing\n');
await db.query('analyze');
const counts = (await db.query<Record<string, number>>(`select (select count(*) from entity)::int as items, (select count(*) from relation)::int as links, (select count(*) from event)::int as events, (select count(*) from proposal)::int as proposals`)).rows[0];
const facts = (await db.query<{ n: number }>(`select count(*)::int as n from entity where type not in ('sys.run', 'sys.notification', 'software.component', 'sys.connection', 'resource')`)).rows[0].n;
console.log(JSON.stringify({ seed: SEED, end: iso(END), days: DAYS, ...counts, facts, seconds: Math.round((performance.now() - t0) / 1000) }));
await db.close();
