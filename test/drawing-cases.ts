// The pictures a drawing is checked on: two real architecture answers (the landing page's hero and one of its
// documents', as published on 22 Oct 2026) and one made to hold every mark the shape has. Each is drawn as the app
// draws it (at a width that keeps its key open, and one that folds it) and as a published page draws it (still).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const here = (...p: string[]) => join(import.meta.dirname, ...p);
/** The house style, as the packs ship it, with the shape asked for. */
export const house = (shape: string) => ({ ...JSON.parse(readFileSync(here('..', 'packs', 'core', 'pack.json'), 'utf8')).styles.find((s: { id: string }) => s.id === 'core.house').props, shape });

const quiet = { blocked: false, waits_on: [] as string[], sessions: 0, needs_you: false };
const within = { items: 0, work: 0, blocked: 0, waiting: 0, sessions: 0, tokens: { estimated: 0, used: 0 }, waits_on: {}, needs_you: 0, not_sent: 0 };
const item = (id: string, title: string, inside: string | undefined, place: number, extra: Record<string, unknown> = {}) => ({ id, type: 'component', root: 'component', kind: 'place', title, status: 'up', open: true, inside, place, size: { work: 0, tokens: { estimated: 0, used: 0 } }, state: quiet, within, ...extra });

/** Every mark: each health, each wire state, what a wire carries, a loop, a store, a client, a question, work on a part, what needs you. */
function variety() {
  const healths = ['up', 'degraded', 'down', 'wiring', 'standby', 'planned', 'mystery'];
  const items = [
    item('e_root0000', 'A system', undefined, 1, { kind: 'work', type: 'project' }),
    item('e_placea00', 'The edge', 'e_root0000', 1),
    item('e_placeb00', 'The servers, with a long name that will not fit', 'e_root0000', 2),
    item('e_placec00', 'Stores', 'e_root0000', 3, { status: 'down' }),
    item('e_client00', 'A browser', 'e_placea00', 1, { role: 'client' }),
    item('e_person00', 'Someone', 'e_placea00', 2, { kind: 'actor', state: { ...quiet, needs_you: true } }),
    ...healths.map((status, n) => item(`e_svc${n}0000`.slice(0, 10), `Service ${status} with a name long enough to be cut`, 'e_placeb00', n + 1, { status })),
    item('e_gone0000', 'Retired service', 'e_placeb00', 9, { status: 'retired', open: false }),
    item('e_ask00000', 'Which store?', 'e_placeb00', 10, { kind: 'question', type: 'inquiry.question' }),
    item('e_db000000', 'Database', 'e_placec00', 1, { role: 'data' }),
    item('e_queue000', 'Queue', 'e_placec00', 2, { role: 'queue', state: { ...quiet, blocked: true, waits_on: ['e_person00'] } }),
    item('e_task0000', 'Wire the queue', 'e_queue000', 1, { kind: 'work', type: 'task', status: 'doing', state: { ...quiet, sessions: 1, needs_you: true } }),
    item('e_task1000', 'Watch it', 'e_queue000', 2, { kind: 'work', type: 'task', status: 'todo' }),
  ];
  const svc = (n: number) => `e_svc${n}0000`.slice(0, 10);
  const links = [
    { kind: 'calls', from: 'e_client00', to: svc(0), n: 1, says: 'HTTPS' },
    { kind: 'calls', from: 'e_client00', to: svc(1), n: 1 },
    { kind: 'calls', from: 'e_person00', to: svc(2), n: 1, state: 'planned', says: 'a very long thing it carries, longer than fits' },
    ...healths.map((_, n) => ({ kind: 'calls', from: svc(n), to: n % 2 ? 'e_db000000' : 'e_queue000', n: 1, ...(n === 3 && { state: 'broken' }), ...(n === 0 && { says: 'SQL' }) })),
    { kind: 'calls', from: 'e_db000000', to: svc(0), n: 1, says: 'a loop' },
    { kind: 'calls', from: 'e_gone0000', to: 'e_db000000', n: 1 },
    { kind: 'calls', from: 'e_ask00000', to: 'e_queue000', n: 1 },
    { kind: 'calls', from: svc(6), to: 'e_ask00000', n: 1, state: 'wired' },
  ];
  return { lens: { from: 'e_root0000', by: 'part_of', over: ['calls'], fold: ['system'] }, items, links, rest: {}, viewer: 'e_person00', controls: ['lit'], views: [] };
}

export interface DrawingCase {
  name: string;
  answer: Record<string, unknown>;
  style: Record<string, unknown>;
  width: number;
}

/** The architecture shape's cases. */
export function architectureCases(): DrawingCase[] {
  const fixture = (name: string) => JSON.parse(readFileSync(here('fixtures', 'drawings', `architecture-${name}.json`), 'utf8'));
  const style = house('architecture');
  const answers = { hero: fixture('hero'), system: fixture('system'), variety: variety() };
  const cases: DrawingCase[] = [];
  for (const [name, answer] of Object.entries(answers)) {
    cases.push({ name: `${name}, wide`, answer, style: { ...style, noLit: name !== 'variety', here: name === 'variety' ? 'e_db000000' : undefined }, width: 1100 });
    cases.push({ name: `${name}, narrow`, answer, style: { ...style, noLit: true }, width: 560 });
    cases.push({ name: `${name}, still`, answer, style: { ...style, noLit: true, still: true }, width: 900 });
  }
  return cases;
}

/** Every mark a process map has: each shape, each dot, a checklist, a question's choices, work on a step, a break. */
function flowVariety() {
  const step = (id: string, title: string, kind: string, extra: Record<string, unknown> = {}) => item(id, title, 'e_froot000', 1, { kind, type: kind === 'work' ? 'task' : kind === 'question' ? 'inquiry.question' : kind === 'record' ? 'inquiry.record' : 'work.milestone', root: kind === 'work' ? 'task' : undefined, status: 'todo', ...extra });
  const items = [
    item('e_froot000', 'A release', undefined, 1, { kind: 'work', type: 'project' }),
    step('e_fstart00', 'Start', 'occurrence', { open: false, status: 'happened' }),
    step('e_fwork100', 'Write it', 'work', { status: 'doing', state: { ...quiet, sessions: 1 } }),
    item('e_fnote000', 'A note on it', 'e_fwork100', 1, { kind: 'work', type: 'task', state: { ...quiet, needs_you: true } }),
    step('e_fask0000', 'Which way, with a long question to cut?', 'question', { choices: ['This way', 'That way', 'Neither'] }),
    step('e_fthis000', 'Go this way', 'work'),
    step('e_frec0000', 'The notes', 'record', { status: 'current' }),
    step('e_fblock00', 'Blocked work', 'work', { state: { ...quiet, blocked: true, waits_on: ['e_fperson0'] } }),
    ...[1, 2, 3, 4, 5].map((k) => step(`e_fpre${k}000`, `Check ${k}`, 'work', { open: k > 2, status: k > 2 ? 'todo' : 'done', ...(k === 3 && { state: { ...quiet, blocked: true, waits_on: [] } }), ...(k === 4 && { state: { ...quiet, needs_you: true } }) })),
    step('e_fgate000', 'Release', 'occurrence', { state: { ...quiet, needs_you: true } }),
  ];
  const on = (from: string, to: string, says?: string) => ({ kind: 'depends_on', from, to, n: 1, ...(says && { says }) });
  const links = [
    on('e_fwork100', 'e_fstart00'),
    on('e_fask0000', 'e_fwork100'),
    on('e_fthis000', 'e_fask0000', 'This way'),
    on('e_frec0000', 'e_fwork100'),
    on('e_fblock00', 'e_frec0000'),
    on('e_fblock00', 'e_fstart00'),
    ...[1, 2, 3, 4, 5].map((k) => on('e_fgate000', `e_fpre${k}000`)),
    on('e_fgate000', 'e_fblock00'),
    on('e_fgate000', 'e_fthis000'),
    on('e_fthis000', 'e_frec0000'),
    on('e_fblock00', 'e_fwork100'),
  ];
  return { lens: { from: 'e_froot000', by: 'part_of', over: ['depends_on'], fold: ['system'] }, items, links, rest: {}, viewer: 'e_fperson0', controls: ['lit'], views: [] };
}

/** The flow shape's cases: three real answers (pages of the public site, 23 Oct 2026) and one with every mark. */
export function flowCases(): DrawingCase[] {
  const fixture = (name: string) => JSON.parse(readFileSync(here('fixtures', 'drawings', `flow-${name}.json`), 'utf8'));
  const style = house('flow');
  const answers = { onemap: fixture('onemap'), session: fixture('session'), inherits: fixture('inherits'), variety: flowVariety() };
  const cases: DrawingCase[] = [];
  for (const [name, answer] of Object.entries(answers)) {
    cases.push({ name: `${name}, wide`, answer, style: { ...style, noLit: name !== 'variety', here: name === 'variety' ? 'e_fwork100' : undefined }, width: 1100 });
    cases.push({ name: `${name}, narrow`, answer, style: { ...style, noLit: true }, width: 560 });
    cases.push({ name: `${name}, still`, answer, style: { ...style, noLit: true, still: true }, width: 900 });
  }
  // The same answers as the flat lens sends them (src/lens-flat.ts), as the canvas draws them, at 1280 and 560 px.
  for (const [name, answer] of Object.entries(answers)) {
    const flat = flatAnswer(answer);
    cases.push({ name: `${name}, flat, wide`, answer: flat, style: { ...style, noLit: true }, width: 1280 });
    cases.push({ name: `${name}, flat, narrow`, answer: flat, style: { ...style, noLit: true }, width: 560 });
  }
  return cases;
}

/**
 * An older lens's answer as the flat lens sends the same items (src/lens-flat.ts): each item its head, the start of
 * its note and its shown fields, with no inside, place, state or within; each link with its type, what an item was
 * inside a part_of link.
 */
export function flatAnswer(answer: any) {
  const at = '2026-10-25T12:00:00.000Z';
  const items = answer.items.map((i: any, k: number) => ({
    id: i.id, kind: i.kind, type: i.type, title: i.title,
    ...(k % 2 === 0 && { body: `${i.title} is one of the things this map holds.\n\nIts note goes on, in a section of its own that a tip does not show.` }),
    visibility: 'shared', status: i.status, open: i.open, owner: null, created_at: at, updated_at: at,
    ...(i.choices && { fields: { choices: i.choices } }),
  }));
  const links = [
    ...answer.links.map((l: any, k: number) => ({ id: `r_flat${String(k).padStart(4, '0')}`, type: l.kind, from: l.from, to: l.to, ...(l.says && { props: { says: l.says } }) })),
    ...answer.items.filter((i: any) => i.inside).map((i: any, k: number) => ({ id: `r_part${String(k).padStart(4, '0')}`, type: 'part_of', from: i.id, to: i.inside })),
  ];
  return { lens: { filter: { find: [`id ${answer.lens.from}`] }, walk: { over: ['part_of', 'depends_on'], steps: 2 }, limit: 500 }, items, links };
}

/** A big system: 12 places of 16 parts, each calling three in the next place. */
export function bigSystem() {
  const hero = architectureCases()[0].answer as any;
  const proto = hero.items.find((i: any) => i.kind === 'place' && i.inside === hero.lens.from);
  const root = hero.items.find((i: any) => i.id === hero.lens.from);
  const id = (p: number, k: number) => `e_p${String(p).padStart(2, '0')}k${String(k).padStart(3, '0')}z`;
  const items = [root, ...Array.from({ length: 12 }, (_, p) => [{ ...proto, id: `e_place${String(p).padStart(3, '0')}`, title: `Place ${p}`, inside: root.id, place: p }, ...Array.from({ length: 16 }, (_, k) => ({ ...proto, id: id(p, k), title: `Part ${p}.${k} with a name`, inside: `e_place${String(p).padStart(3, '0')}`, place: k }))]).flat()];
  const links = Array.from({ length: 11 }, (_, p) => Array.from({ length: 16 }, (_, k) => [0, 3, 7].map((d) => ({ kind: 'calls', from: id(p, k), to: id(p + 1, (k + d) % 16), n: 1 })))).flat(2);
  return { ...hero, items, links };
}

/** Every mark a grid has: rows at two depths and loose things, lanes named and by person, a colour by a field and the
 * style's own, a second line, a date marked, what is finished, what needs you, what was opened from, and rows by a link. */
function gridVariety(byLink: boolean) {
  const card = (id: string, title: string, inside: string, place: number, lane: string | null, fields: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => item(id, title, inside, place, { lane, fields, ...extra });
  const items = [
    item('e_groot000', 'A grid', undefined, 1, { kind: 'work', type: 'project' }),
    item('e_grow1000', 'The first row, with a name long enough to be cut', 'e_groot000', 1, { kind: 'work', type: 'project' }),
    card('e_gcard100', 'A store', 'e_grow1000', 1, 'doing', { role: 'data', layer: 'store' }),
    card('e_gcard200', 'A browser with a title long enough to be cut in its card', 'e_grow1000', 2, 'doing', { role: 'client', layer: 'yours', due: '2026-11-05', due_note: 'Due' }),
    card('e_gcard300', 'Finished', 'e_grow1000', 3, 'done', { role: 'app' }, { open: false, status: 'retired' }),
    item('e_gsub0000', 'Inside the first', 'e_grow1000', 4, { kind: 'work', type: 'project', lane: 'doing' }),
    card('e_gdeep000', 'Two down', 'e_gsub0000', 1, 'e_gperson0', { role: 'monitor', due: '2026-12-01' }, { state: { ...quiet, needs_you: true } }),
    item('e_grow2000', 'The second row', 'e_groot000', 2, { kind: 'work', type: 'project' }),
    card('e_gcard400', 'Nothing filed', 'e_grow2000', 1, null, {}),
    card('e_gcard500', 'A model', 'e_grow2000', 2, 'odd_value', { role: 'model', layer: 'outside' }),
    card('e_gloose00', 'Held directly', 'e_groot000', 3, 'doing', { role: 'tool' }),
  ];
  const links = byLink
    ? [
        { kind: 'depends_on', from: 'e_gcard100', to: 'e_gcard400', n: 1, says: 'needs it' },
        { kind: 'depends_on', from: 'e_gcard200', to: 'e_gcard400', n: 1 },
        { kind: 'depends_on', from: 'e_gcard200', to: 'e_gcard500', n: 1, says: 'calls' },
      ]
    : [];
  return { lens: { from: 'e_groot000', by: 'part_of', over: ['depends_on'], fold: ['system'] }, lanes: ['doing', { key: 'e_gperson0', title: 'Someone' }, 'done'], items, links, rest: {}, viewer: 'e_gperson0', controls: [], views: [] };
}

/** The grid shape's cases: two real answers (pages of the public site, 23 Oct 2026) and two with every mark. */
export function gridCases(): DrawingCase[] {
  const fixture = (name: string) => JSON.parse(readFileSync(here('fixtures', 'drawings', `grid-${name}.json`), 'utf8'));
  const style = house('grid');
  const cases: DrawingCase[] = [];
  const answers: [string, unknown, Record<string, unknown>][] = [
    ['kernels', fixture('kernels'), { labels: { null: 'Its kinds of thing' } }],
    ['plans', fixture('plans'), { labels: { null: 'Price' } }],
    ['variety', gridVariety(false), { color_by: 'role', detail: 'layer', mark: 'due', here: 'e_gdeep000', labels: { doing: 'Under way' } }],
    ['links', gridVariety(true), { rows: 'link:depends_on', color_by: 'role', palette: { data: '#123456' }, lit: 'you' }],
  ];
  for (const [name, answer, own] of answers) {
    cases.push({ name: `${name}, wide`, answer: answer as Record<string, unknown>, style: { ...style, ...own, noLit: true }, width: 1100 });
    cases.push({ name: `${name}, narrow`, answer: answer as Record<string, unknown>, style: { ...style, ...own, noLit: true }, width: 560 });
    cases.push({ name: `${name}, still`, answer: answer as Record<string, unknown>, style: { ...style, ...own, noLit: true, still: true }, width: 900 });
  }
  return cases;
}

/** A week on a time axis with every mark: two lanes (a person and the sessions), things that overlap, a stretch of a
 * session's minutes, a due date and a span of days in the strip, what each counts toward, and an early start. */
function timeVariety() {
  const at = (id: string, title: string, kind: string, lane: string, time: Record<string, unknown>[], extra: Record<string, unknown> = {}) => item(id, title, 'e_troot000', 1, { kind, type: kind === 'work' ? 'task' : 'event', lane, time, ...extra });
  const items = [
    item('e_troot000', 'A week', undefined, 1, { kind: 'work', type: 'project' }),
    at('e_ttask100', 'Write the copy, with a long name to cut', 'work', 'e_tsam0000', [{ start: '2026-11-03T09:00:00', end: '2026-11-03T11:30:00', by: 'logged', stream: 'e_tproj000' }]),
    at('e_ttask200', 'Review', 'work', 'e_tsam0000', [{ start: '2026-11-03T10:00:00', end: '2026-11-03T12:00:00', by: 'logged', stream: 'e_tproj100' }, { start: '2026-11-04T14:00:00', end: '2026-11-04T15:00:00', by: 'logged', stream: 'e_tproj100' }]),
    at('e_tdue0000', 'Due', 'work', 'e_tsam0000', [{ start: '2026-11-05', end: '2026-11-05', by: 'bound' }]),
    at('e_tspan000', 'Away', 'occurrence', 'e_tsam0000', [{ start: '2026-11-04T00:00:00', end: '2026-11-07T00:00:00', by: 'planned' }]),
    at('e_tsess000', 'A session', 'work', 'sessions', [{ start: '2026-11-03T13:00:00', end: '2026-11-03T13:03:00', on_title: 'Fix it' }, { start: '2026-11-03T13:04:00', end: '2026-11-03T13:40:00', on_title: 'Fix it' }, { start: '2026-11-06T06:15:00', end: '2026-11-06T07:00:00', on_title: 'Early' }], { open: false }),
  ];
  return { lens: { from: 'e_troot000', by: 'part_of', over: [], fold: ['system'], time: { from: '2026-11-02', to: '2026-11-08' } }, lanes: [{ key: 'e_tsam0000', title: 'Sam' }, { key: 'sessions', title: 'Sessions' }], streams: [{ key: 'e_tproj000', title: 'Website' }, { key: 'e_tproj100', title: 'Billing' }], items, links: [], rest: {}, viewer: 'e_tsam0000', controls: [], views: [] };
}

/** The time shape's cases: the public site's plan as bars (23 Oct 2026), and a week with every mark as a calendar and as bars. */
export function timeCases(): DrawingCase[] {
  const launch = JSON.parse(readFileSync(here('fixtures', 'drawings', 'time-launch.json'), 'utf8'));
  const style = house('time');
  const cases: DrawingCase[] = [];
  const answers: [string, unknown, Record<string, unknown>][] = [
    ['launch', launch, { layout: 'bars' }],
    ['week', timeVariety(), {}],
    ['week bars', timeVariety(), { layout: 'bars' }],
    ['week hours', timeVariety(), { hours: [7, 15] }],
  ];
  for (const [name, answer, own] of answers) {
    cases.push({ name: `${name}, wide`, answer: answer as Record<string, unknown>, style: { ...style, ...own, noLit: true }, width: 1100 });
    cases.push({ name: `${name}, narrow`, answer: answer as Record<string, unknown>, style: { ...style, ...own, noLit: true }, width: 560 });
    cases.push({ name: `${name}, still`, answer: answer as Record<string, unknown>, style: { ...style, ...own, noLit: true, still: true }, width: 900 });
  }
  return cases;
}
