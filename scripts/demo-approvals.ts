// A second demo: `npm run demo:approvals`. A server of its own (port 3201, its
// data in demo-approvals/, never data/), filled the first time with a made-up
// planning file: an owner wants an industrial building on a rural lot, and the
// town has held the pre-consultation. You are the owner's planning consultant.
// The town, the region, the conservation authority and MTO are circulating
// comments; some are in, some are late, and the checklist of studies is half
// built. Two agent sessions are at work on it, and one change waits for you.
// `npm run demo:approvals -- --fresh` throws the map away and makes it again.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const DIR = join(ROOT, 'demo-approvals');
const PORT = 3201;
const BASE = `http://127.0.0.1:${PORT}`;

/** The process map's style as the one module a style keeps: the built-in flow layout joined in before its drawing. */
function processCode(): string {
  const layout = readFileSync(join(ROOT, 'packs', 'core', 'draw', 'flow', 'layout.js'), 'utf8').replace(/^export function layout/m, 'function layout');
  const drawing = readFileSync(join(ROOT, 'examples', 'approvals', 'process.js'), 'utf8');
  return `${layout}\n${drawing.replace(/^import \{ layout \} from .*\n/m, '')}`;
}

if (process.argv.includes('--fresh')) rmSync(DIR, { recursive: true, force: true });
mkdirSync(DIR, { recursive: true });

const server = spawn(process.execPath, [join(ROOT, 'src', 'server.ts')], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, PELAGO_DATA: join(DIR, 'data'), PELAGO_PORT: String(PORT), PELAGO_HOST: '127.0.0.1', PELAGO_AUTH: 'off', PELAGO_DEV: '0' },
});
server.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.kill(signal));

async function call<T = any>(surface: 'api' | 'agent', tool: string, input: unknown = {}): Promise<T> {
  const res = await fetch(`${BASE}/${surface}/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const body = (await res.json()) as { result?: T; error?: string };
  if (!res.ok) throw new Error(`${tool}: ${body.error}`);
  return body.result as T;
}
const human = <T = any>(tool: string, input?: unknown) => call<T>('api', tool, input);
const agent = <T = any>(tool: string, input?: unknown) => call<T>('agent', tool, { actor: 'claude-code', ...(input as object) });

async function ready(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('The demo server did not start.');
}

const source = { uri: 'scripts/demo-approvals.ts', kind: 'file', title: 'The approvals demo' };

// The words of the planning process, defined in the map itself: no code, no pack.
const TYPES = [
  {
    id: 'local.party', title: 'Party', extends: 'company',
    description: 'A body with a part in an application: the owner, their consultant, the town and its departments, and the agencies it circulates to.',
    fields: { kind: { type: 'enum', values: ['owner', 'consultant', 'municipality', 'department', 'region', 'conservation authority', 'province'], shown: true } },
  },
  {
    id: 'local.property', title: 'Property', extends: 'resource',
    description: 'A lot, with what the plans already say may be built on it.',
    fields: { address: { type: 'string' }, area_ha: { type: 'number' }, zoning: { type: 'string' }, official_plan: { type: 'string' }, regulated: { type: 'boolean', description: 'Partly within a conservation authority regulated area.' } },
  },
  {
    id: 'local.application', title: 'Application', extends: 'project',
    description: 'A planning application the proposal needs before it can be built.',
    statuses: { open: ['identified', 'preparing', 'submitted', 'under review'], closed: ['approved', 'refused', 'withdrawn'] },
    fields: { fee: { type: 'number', shown: true }, approver: { type: 'string' } },
  },
  {
    id: 'local.study', title: 'Study', extends: 'task',
    description: 'A study or plan a commenter asked for at pre-consultation, to be submitted with an application.',
    statuses: { open: ['required', 'scoping', 'under way', 'submitted'], closed: ['accepted', 'waived'] },
    fields: { est_cost: { type: 'number', shown: true, description: 'Estimated fee, in dollars.' }, est_weeks: { type: 'number', shown: true }, season: { type: 'string', description: 'When in the year the fieldwork can be done.' } },
  },
  {
    id: 'local.comment', title: 'Comments', extends: 'record',
    description: "A commenter's written comments on the proposal.",
    statuses: { open: ['received'], closed: ['superseded'] },
    fields: { received_on: { type: 'date', shown: true } },
  },
];

const DUE = '2026-10-13'; // comments were asked for three weeks after the meeting

async function fill(): Promise<void> {
  const { me } = await human('init', { name: 'You' });
  await human('change', { reason: 'The words of the approvals process', source, ops: TYPES.map((type) => ({ op: 'define_type', type })) });

  const { created: m } = await human('change', {
    reason: 'The demo: a pre-consultation for an industrial building',
    source,
    ops: [
      // Who is in it.
      { op: 'create', ref: 'firm', type: 'local.party', title: 'Ridgeline Planning', status: 'active', props: { kind: 'consultant' } },
      { op: 'link', type: 'works_at', from: me, to: 'firm' },
      { op: 'create', ref: 'own', type: 'local.party', title: 'Northfield Holdings', status: 'active', props: { kind: 'owner' } },
      { op: 'create', ref: 'mark', type: 'person', title: 'Mark Delaney', status: 'active', props: { role: 'President' } },
      { op: 'link', type: 'works_at', from: 'mark', to: 'own' },
      { op: 'create', ref: 'town', type: 'local.party', title: 'Town of Millbrook', status: 'active', props: { kind: 'municipality' } },
      ...[
        ['plan', 'Planning', 'daniel', 'Daniel Ferreira', 'File planner'],
        ['eng', 'Engineering', 'mei', 'Mei Lin', 'Development engineer'],
        ['parks', 'Parks', 'tom', 'Tom Brennan', 'Parks planner'],
        ['forest', 'Forestry', 'aisha', 'Aisha Mohamed', 'Urban forester'],
        ['legal', 'Legal', 'robert', 'Robert Kowalski', 'Solicitor'],
        ['fire', 'Fire', 'sarah', 'Sarah Dubois', 'Fire prevention officer'],
        ['bldg', 'Building', 'greg', 'Greg Tanaka', 'Plans examiner'],
      ].flatMap(([ref, title, who, name, role]) => [
        { op: 'create', ref, type: 'local.party', title: `Millbrook ${title}`, status: 'active', props: { kind: 'department' } },
        { op: 'link', type: 'part_of', from: ref, to: 'town' },
        { op: 'create', ref: who, type: 'person', title: name, status: 'active', props: { role } },
        { op: 'link', type: 'works_at', from: who, to: ref },
      ]),
      ...[
        ['region', 'Region of Cedar Valley', 'region', 'hannah', 'Hannah Morris', 'Development planner'],
        ['ca', 'Cedar Valley Conservation', 'conservation authority', 'liam', "Liam O'Connor", 'Plans reviewer'],
        ['mto', 'MTO Corridor Management', 'province', 'nadia', 'Nadia Rahman', 'Corridor management officer'],
      ].flatMap(([ref, title, kind, who, name, role]) => [
        { op: 'create', ref, type: 'local.party', title, status: 'active', props: { kind } },
        { op: 'create', ref: who, type: 'person', title: name, status: 'active', props: { role } },
        { op: 'link', type: 'works_at', from: who, to: ref },
      ]),
      { op: 'create', ref: 'reader', type: 'agent', title: 'Comment reader', status: 'active', props: { kind: 'claude-code' } },
      { op: 'create', ref: 'estimator', type: 'agent', title: 'Estimator', status: 'active', props: { kind: 'claude-code' } },

      // The lot and the proposal.
      {
        op: 'create', ref: 'lot', type: 'local.property', title: '4180 Concession Road 6', status: 'available',
        props: { address: '4180 Concession Road 6, Millbrook', area_ha: 6.2, zoning: 'Rural (A1)', official_plan: 'Employment Area', regulated: true },
        body: 'A 6.2 ha field on the edge of town, designated for employment but still zoned rural. Millers Creek crosses the south-east corner, so part of the lot is regulated by the conservation authority, and the lot sits within MTO\'s permit control area for Highway 7.',
      },
      {
        op: 'create', ref: 'p', type: 'project', title: '4180 Concession Rd 6: industrial', status: 'active', owner: me,
        body: 'Northfield wants two light industrial buildings on this lot. The town held the pre-consultation on 22 September; comments were due on 13 October and four are still out. When the checklist is complete, Northfield decides whether to go ahead.\n\nWhat is proposed\nTwo buildings, 18,500 m² together, for warehousing and light manufacturing, with truck access from Concession Road 6 and 140 parking spaces.\n\nWhere it stands\nThe applications are known: a zoning amendment and a site plan, plus permits from the conservation authority and MTO. The study list is half built, and the studies with the longest lead time are the ones still waiting on comments.',
      },
      { op: 'link', type: 'about', from: 'p', to: 'lot' },
      { op: 'link', type: 'requested_by', from: 'p', to: 'own' },
      { op: 'link', type: 'involves', from: 'p', to: 'town' },
      { op: 'link', type: 'involves', from: 'p', to: 'region' },
      { op: 'link', type: 'involves', from: 'p', to: 'ca' },
      { op: 'link', type: 'involves', from: 'p', to: 'mto' },
      { op: 'create', ref: 'concept', type: 'document', title: 'Concept plan', status: 'ready', body: 'The site layout Northfield sent the town: two buildings, a truck court facing the highway, and a stormwater pond in the south-east corner, inside the regulated area.' },
      { op: 'link', type: 'part_of', from: 'concept', to: 'p' },
      { op: 'link', type: 'produced', from: 'own', to: 'concept' },

      // The meeting.
      { op: 'create', ref: 'meet', type: 'meeting', title: 'Pre-consultation meeting', status: 'happened', props: { at: '2026-09-22T14:00:00-04:00', location: 'Millbrook Town Hall, Room 2' } },
      { op: 'link', type: 'part_of', from: 'meet', to: 'p' },
      { op: 'link', type: 'about', from: 'meet', to: 'concept' },
      ...['plan', 'eng', 'parks', 'forest', 'legal', 'fire', 'bldg', 'region', 'ca', 'mto', 'own', 'firm'].map((x) => ({ op: 'link', type: 'involves', from: 'meet', to: x })),

      // Which applications, decided by the town at the meeting.
      {
        op: 'create', ref: 'which', type: 'decision', title: 'Which applications are needed?', status: 'decided',
        props: { options: ['Zoning amendment and site plan', 'Official plan and zoning amendment, and site plan', 'Site plan only'], outcome: 'Zoning amendment and site plan', rationale: 'The official plan already allows employment uses here; the rural zoning does not, so only the zoning changes.', decided_on: '2026-09-22' },
      },
      { op: 'link', type: 'part_of', from: 'which', to: 'p' },
      { op: 'link', type: 'requested_by', from: 'which', to: 'plan' },
      { op: 'create', ref: 'zba', type: 'local.application', title: 'Zoning by-law amendment', status: 'identified', props: { fee: 24800, approver: 'Millbrook Council' } },
      { op: 'create', ref: 'spa', type: 'local.application', title: 'Site plan approval', status: 'identified', props: { fee: 31500, approver: 'Millbrook Planning' } },
      { op: 'create', ref: 'caperm', type: 'local.application', title: 'Conservation authority permit', status: 'identified', props: { fee: 4900, approver: 'Cedar Valley Conservation' } },
      { op: 'create', ref: 'mtoperm', type: 'local.application', title: 'MTO building and land use permit', status: 'identified', props: { fee: 0, approver: 'MTO' } },
      ...['zba', 'spa', 'caperm', 'mtoperm'].map((a) => ({ op: 'link', type: 'part_of', from: a, to: 'p' })),
      { op: 'link', type: 'produced', from: 'which', to: 'zba' },
      { op: 'link', type: 'produced', from: 'which', to: 'spa' },
      { op: 'link', type: 'depends_on', from: 'spa', to: 'zba' },

      // The circulation: one step holding each commenter's comments, some answered.
      { op: 'create', ref: 'circ', type: 'task', title: 'Circulation for comments', status: 'doing', owner: me, props: { due: DUE }, body: 'The town sent the concept to its departments and to the region, the conservation authority and MTO, with comments due on 13 October.' },
      { op: 'link', type: 'part_of', from: 'circ', to: 'p' },
      ...[
        ['c_plan', 'plan', 'daniel', 'Planning', 'done', '2026-09-29'],
        ['c_parks', 'parks', 'tom', 'Parks', 'done', '2026-10-02'],
        ['c_legal', 'legal', 'robert', 'Legal', 'done', '2026-10-06'],
        ['c_fire', 'fire', 'sarah', 'Fire', 'done', '2026-10-08'],
        ['c_bldg', 'bldg', 'greg', 'Building', 'done', '2026-10-09'],
        ['c_region', 'region', 'hannah', 'Region', 'done', '2026-10-13'],
        ['c_eng', 'eng', 'mei', 'Engineering', 'waiting', null],
        ['c_forest', 'forest', 'aisha', 'Forestry', 'waiting', null],
        ['c_ca', 'ca', 'liam', 'Conservation authority', 'waiting', null],
        ['c_mto', 'mto', 'nadia', 'MTO', 'waiting', null],
      ].flatMap(([ref, party, who, name, status, on]) => [
        { op: 'create', ref, type: 'task', title: `${name} comments`, status, props: { due: DUE } },
        { op: 'link', type: 'part_of', from: ref, to: 'circ' },
        { op: 'link', type: 'owed_to', from: ref, to: 'firm' },
        ...(on
          ? [
              { op: 'create', ref: `${ref}_doc`, type: 'local.comment', title: `${name} comments`, status: 'received', props: { received_on: on } },
              { op: 'link', type: 'produced', from: ref, to: `${ref}_doc` },
              { op: 'link', type: 'requested_by', from: `${ref}_doc`, to: party },
              { op: 'link', type: 'part_of', from: `${ref}_doc`, to: 'p' },
            ]
          : [{ op: 'link', type: 'waits_on', from: ref, to: who, props: { for: `${name} comments on the concept` } }]),
      ]),

      // The checklist, as far as it goes.
      { op: 'create', ref: 'list', type: 'document', title: 'Study checklist', status: 'draft', body: 'What the commenters asked to see with the applications. Built from each set of comments as it comes in; four are still out, and they are the ones that set the pace (stormwater, the creek, the highway).' },
      { op: 'link', type: 'part_of', from: 'list', to: 'p' },
      ...[
        ['pjr', 'Planning justification report', 'required', 'plan', 18000, 8, null],
        ['tis', 'Traffic impact study', 'scoping', 'region', 32000, 12, null],
        ['fsr', 'Functional servicing report', 'required', 'region', 28000, 10, null],
        ['noise', 'Noise and vibration study', 'required', 'region', 14000, 6, null],
        ['arch', 'Archaeological assessment, stages 1–2', 'required', 'region', 22000, 10, 'Stage 2 needs a ploughed field: April to November'],
        ['esa', 'Phase one environmental site assessment', 'required', 'legal', 6500, 4, null],
        ['geo', 'Geotechnical investigation', 'required', 'bldg', 19000, 6, null],
        ['firep', 'Fire access and water supply plan', 'required', 'fire', 7500, 3, null],
        ['park', 'Parkland cash-in-lieu appraisal', 'required', 'parks', 4500, 3, null],
      ].flatMap(([ref, title, status, by, cost, weeks, season]) => [
        { op: 'create', ref, type: 'local.study', title, status, props: { est_cost: cost, est_weeks: weeks, ...(season ? { season } : {}) } },
        { op: 'link', type: 'part_of', from: ref, to: 'list' },
        { op: 'link', type: 'requested_by', from: ref, to: by },
      ]),
      // Known to be coming, though the comments asking for them are not in.
      {
        op: 'create', ref: 'eis', type: 'local.study', title: 'Environmental impact study', status: 'required',
        props: { est_cost: 45000, est_weeks: 36, season: 'Breeding bird and amphibian surveys: April to July' },
        body: 'The conservation authority said at the meeting it would want one, for the creek and the wet meadow along it. Its comments are not in yet, so the scope is not known; the surveys can only be done in spring, which makes this the longest study on the list.',
      },
      { op: 'create', ref: 'swm', type: 'local.study', title: 'Stormwater management report', status: 'required', props: { est_cost: 26000, est_weeks: 10 }, body: 'Engineering and the conservation authority will both review it; neither has sent comments yet, so the design storm and the outlet to the creek are still open.' },
      { op: 'link', type: 'part_of', from: 'eis', to: 'list' },
      { op: 'link', type: 'part_of', from: 'swm', to: 'list' },
      { op: 'link', type: 'requested_by', from: 'eis', to: 'ca' },
      { op: 'link', type: 'requested_by', from: 'swm', to: 'eng' },
      { op: 'link', type: 'depends_on', from: 'eis', to: 'c_ca' },
      { op: 'link', type: 'depends_on', from: 'swm', to: 'c_eng' },
      { op: 'link', type: 'depends_on', from: 'swm', to: 'c_ca' },
      { op: 'link', type: 'depends_on', from: 'swm', to: 'geo' },
      { op: 'link', type: 'depends_on', from: 'fsr', to: 'geo' },
      { op: 'link', type: 'depends_on', from: 'tis', to: 'c_mto' },

      // What each application needs.
      ...['pjr', 'tis', 'fsr', 'noise', 'arch', 'esa', 'eis'].map((s) => ({ op: 'link', type: 'depends_on', from: 'zba', to: s })),
      ...['geo', 'swm', 'firep', 'park'].map((s) => ({ op: 'link', type: 'depends_on', from: 'spa', to: s })),
      ...['eis', 'swm'].map((s) => ({ op: 'link', type: 'depends_on', from: 'caperm', to: s })),
      { op: 'link', type: 'depends_on', from: 'mtoperm', to: 'tis' },

      // The checklist goes to the owner when every comment is in.
      {
        op: 'create', ref: 'handover', type: 'event', title: 'Checklist to Northfield', status: 'upcoming', props: { at: '2026-10-30T10:00:00-04:00' },
        body: 'We send Northfield the full study list with costs and a timeline, and they decide whether to go ahead. It waits for every set of comments; the estimate can follow.',
      },
      { op: 'link', type: 'part_of', from: 'handover', to: 'p' },
      ...['c_plan', 'c_parks', 'c_legal', 'c_fire', 'c_bldg', 'c_region', 'c_eng', 'c_forest', 'c_ca', 'c_mto', 'list'].map((x) => ({ op: 'link', type: 'depends_on', from: 'handover', to: x })),

      // Work on our side.
      { op: 'create', ref: 'chase', type: 'task', title: 'Chase the late comments', status: 'todo', owner: me, props: { due: '2026-10-20', priority: 'high' }, body: 'Engineering, Forestry, the conservation authority and MTO are past the 13 October date. The conservation authority wants a site visit first, so ask for a date.' },
      { op: 'link', type: 'part_of', from: 'chase', to: 'circ' },
      { op: 'link', type: 'waits_on', from: 'chase', to: me, props: { for: 'emailing the four late commenters' } },
      {
        op: 'create', ref: 'go', type: 'decision', title: 'Go ahead with the applications?', status: 'open',
        props: { options: ['Go ahead as proposed', 'Move the pond out of the regulated area, then go ahead', 'Do not go ahead'], due: '2026-11-13' },
        body: 'Northfield\'s call, once they have the checklist. What weighs on it is the environmental impact study: its surveys can only start in April, which puts the zoning amendment into late 2027.',
      },
      { op: 'link', type: 'part_of', from: 'go', to: 'p' },
      { op: 'link', type: 'depends_on', from: 'go', to: 'handover' },
      { op: 'link', type: 'waits_on', from: 'go', to: 'mark', props: { for: 'deciding whether to go ahead' } },

      // The order of the process: each step depends on the one before it.
      { op: 'link', type: 'depends_on', from: 'meet', to: 'concept' },
      { op: 'link', type: 'depends_on', from: 'circ', to: 'meet' },
      ...['c_plan', 'c_parks', 'c_legal', 'c_fire', 'c_bldg', 'c_region', 'c_eng', 'c_forest', 'c_ca', 'c_mto'].map((x) => ({ op: 'link', type: 'depends_on', from: x, to: 'circ' })),
      // The checklist is written from every set of comments.
      ...['c_plan', 'c_parks', 'c_legal', 'c_fire', 'c_bldg', 'c_region', 'c_eng', 'c_forest', 'c_ca', 'c_mto'].map((c) => ({ op: 'link', type: 'depends_on', from: 'list', to: c })),
      { op: 'link', type: 'depends_on', from: 'which', to: 'meet' },
      // The checklist is made for the applications the town named.
      { op: 'link', type: 'depends_on', from: 'list', to: 'which' },
      ...[['pjr', 'c_plan'], ['tis', 'c_region'], ['fsr', 'c_region'], ['noise', 'c_region'], ['arch', 'c_region'], ['esa', 'c_legal'], ['geo', 'c_bldg'], ['firep', 'c_fire'], ['park', 'c_parks']].map(([s, c]) => ({ op: 'link', type: 'depends_on', from: s, to: c })),
      // The studies are commissioned, and the applications filed, only if Northfield goes ahead.
      ...['pjr', 'tis', 'fsr', 'noise', 'arch', 'esa', 'geo', 'firep', 'park', 'eis', 'swm', 'zba', 'caperm', 'mtoperm'].map((a) => ({ op: 'link', type: 'depends_on', from: a, to: 'go', props: { says: 'Go ahead as proposed' } })),

      // The project opens on the process, drawn from the top down (examples/approvals/process.js).
      { op: 'create', ref: 'lens', type: 'lens', title: 'Process', status: 'current', props: { place: 0, far: 2, over: ['depends_on'], kinds: ['-actor', '-local.comment'], fold: ['system'] } },
      { op: 'link', type: 'about', from: 'lens', to: 'p' },
      { op: 'create', ref: 'style', type: 'style', title: 'Process', status: 'current', props: { code: processCode() } },
      { op: 'link', type: 'about', from: 'style', to: 'lens' },
    ],
  });

  // The comment reader: it reads each set of comments into the checklist, and has a draft from Forestry.
  const reader = await call('agent', 'session_start', { actor: 'comment-reader', title: 'Read the comments into the checklist', task: m.list, surface: 'claude-code' });
  await call('agent', 'tell', {
    actor: 'comment-reader', run: reader.run,
    said: 'Six of ten commenters have answered; their comments ask for nine studies, all on the checklist.',
    about: [m.list, m.c_region_doc, m.c_plan_doc],
    links: [{ from: m.c_region_doc, to: m.list, says: 'four studies from' }],
  });
  await call('agent', 'change', {
    actor: 'comment-reader',
    reason: 'Forestry sent a draft by email: a tree inventory and preservation plan for the hedgerow along the north line',
    authority: { of: 'agent', basis: "Aisha Mohamed's email of 15 October, marked draft" },
    source: { uri: 'mail:forestry-draft-2026-10-15', kind: 'email', title: 'Forestry draft comments' },
    hold: true,
    ops: [
      { op: 'create', ref: 'trees', type: 'local.study', title: 'Tree inventory and preservation plan', status: 'required', props: { est_cost: 8500, est_weeks: 4 } },
      { op: 'link', type: 'part_of', from: 'trees', to: m.list },
      { op: 'link', type: 'requested_by', from: 'trees', to: m.forest },
      { op: 'link', type: 'depends_on', from: m.spa, to: 'trees' },
      { op: 'link', type: 'depends_on', from: 'trees', to: m.go, props: { says: 'Go ahead as proposed' } },
    ],
  });
  await call('agent', 'tell', {
    actor: 'comment-reader', run: reader.run, finding: true,
    said: 'The four commenters still out are the ones that set the timeline: the creek, stormwater and the highway. Forestry\'s draft asks for a tree plan; it waits for your yes.',
    about: [m.c_ca, m.c_eng, m.c_mto, m.c_forest, m.eis, m.swm],
    links: [{ from: m.eis, to: m.c_ca, says: 'waits for' }, { from: m.swm, to: m.c_eng, says: 'waits for' }],
  });

  // The estimator: what the checklist costs so far, and how long it takes.
  const est = await call('agent', 'session_start', { actor: 'estimator', title: 'Estimate cost and time for Northfield', task: m.go, surface: 'claude-code' });
  await call('agent', 'tell', {
    actor: 'estimator', run: est.run, finding: true,
    said: 'The studies so far come to about $223,000 and the applications to $61,200. The environmental impact study sets the pace: its surveys start in April, so the zoning amendment cannot be filed before autumn 2027.',
    about: [m.go, m.eis, m.zba, m.list],
    links: [{ from: m.zba, to: m.eis, says: 'waits for' }, { from: m.go, to: m.eis, says: 'weighs on' }],
  });
  await call('agent', 'session_end', { actor: 'estimator', run: est.run, outcome: 'finished', summary: 'A first estimate for the go-ahead decision; it firms up when the last comments are in.' });
}

await ready();
const info = await human('workspace_info');
if (!info.owner) {
  await fill();
  console.log('\nThe approvals demo is made.');
}
console.log(`\nApprovals demo: open ${BASE}\nIts data is in demo-approvals/; npm run demo:approvals -- --fresh starts it again from nothing. Ctrl+C stops it.\n`);
