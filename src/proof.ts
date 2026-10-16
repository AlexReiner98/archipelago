// What a test run found, and the pictures kept for results and figures. The proof questions those results answer,
// and the changelog, are the software pack's views (packs/software/proof.js).

import { actorId, type Actor, type Entity, type Archipelago, type Op } from './pelago.ts';

export interface TestReport {
  build: string;
  results: { test: string; passed: boolean; value?: string; evidence?: string; picture?: string }[];
  link?: string;
}

/**
 * What a test run found, on one build. One result is kept for each test on
 * each build: reported again, it is replaced. A test the map does not know is
 * named in the answer and nothing is made for it, so a harness cannot fill
 * the map with tests nobody placed under a question.
 */
export async function reportTests(l: Archipelago, actor: Actor, input: TestReport) {
  const build = input.build.trim();
  if (!build) throw new Error('test_report needs "build": the version or commit the tests ran on.');
  const { rows: tests } = await l.db.query<Entity>(`select id, title, props from entity where type = any($1::text[]) and archived_at is null`, [l.registry.family('software.test')]);
  const find = (key: string) => tests.find((t) => t.id === key) ?? tests.find((t) => t.props.entrypoint === key);
  const { rows: kept } = await l.db.query<{ test: string; id: string; build: string | null }>(
    `select r.from_id as test, e.id, e.props->>'build' as build from relation r join entity e on e.id = r.to_id
     where r.type = 'produced' and r.valid_to is null and e.archived_at is null and e.type = any($1::text[])`,
    [l.registry.family('software.test_result')],
  );
  const today = new Date().toISOString().slice(0, 10);
  const ops: Op[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  let passed = 0;
  let failed = 0;
  for (const [i, r] of input.results.entries()) {
    const test = find(r.test);
    if (!test) {
      unknown.push(r.test);
      continue;
    }
    if (seen.has(test.id)) throw new Error(`test_report: "${r.test}" is reported twice for build ${build}.`);
    seen.add(test.id);
    if (r.passed) passed++;
    else failed++;
    const before = kept.find((k) => k.test === test.id && k.build === build);
    if (before) {
      // What the last run said and this one does not is cleared, not left standing.
      ops.push({ op: 'update', id: before.id, status: 'recorded', props: { passed: r.passed, measured_on: today, value: r.value ?? null, evidence: r.evidence ?? null, picture: r.picture ?? null } });
      continue;
    }
    const ref = `result${i}`;
    const props: Record<string, unknown> = { build, passed: r.passed, measured_on: today };
    if (r.value !== undefined) props.value = r.value;
    if (r.evidence !== undefined) props.evidence = r.evidence;
    if (r.picture !== undefined) props.picture = r.picture;
    ops.push({ op: 'create', ref, type: 'software.test_result', title: `${build}: ${test.title}`.slice(0, 60), props }, { op: 'link', type: 'produced', from: test.id, to: ref });
  }
  if (!ops.length) return { build, recorded: 0, passed, failed, unknown };
  const result = await l.change(actor, {
    ops,
    reason: `Test results for build ${build}: ${passed} passed, ${failed} failed`,
    authority: { of: 'agent', basis: `Reported by a test run${input.link ? ` (${input.link})` : ''}` },
  });
  // A test that is run again loses the picture kept for it: the old one no longer shows what the test found.
  const removed = result.status === 'applied' ? await dropPictures(l, actor, [...seen], `Run again on build ${build}`) : 0;
  // A public result shows its picture, and the picture is where the test ran: say which are owed.
  const { rows: owed } =
    result.status === 'applied'
      ? await l.db.query<{ result: string; picture: string }>(
          `select e.id as result, e.props->>'picture' as picture from relation r join entity e on e.id = r.to_id
           where r.type = 'produced' and r.valid_to is null and r.from_id = any($1::text[]) and e.archived_at is null
             and e.props->>'build' = $2 and e.props->>'picture' is not null
             and exists (select 1 from relation a join entity q on q.id = a.to_id
                         where a.type = 'software.answers' and a.valid_to is null and a.from_id = r.from_id and q.visibility = 'public' and q.archived_at is null)`,
          [[...seen], build],
        )
      : { rows: [] };
  return { status: result.status, build, recorded: seen.size, passed, failed, unknown, pictures_removed: removed, send_pictures: owed };
}

/** The most a kept picture may weigh. A capture of a view at screen size is well under it. */
export const PICTURE_MAX = 1_000_000;
const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Remove the kept pictures of every result of these tests. */
async function dropPictures(l: Archipelago, actor: Actor, tests: string[], reason: string): Promise<number> {
  const { rows } = await l.db.query<{ entity_id: string }>(
    `delete from picture where entity_id in (select to_id from relation where type = 'produced' and valid_to is null and from_id = any($1::text[])) returning entity_id`,
    [tests],
  );
  for (const row of rows) await l.log(l.db, { actor: actorId(actor), action: 'picture.removed', target: row.entity_id, reason });
  return rows.length;
}

/**
 * Keep the picture a test drew, for one result, or the figure a document shows
 * with one of its sections (a note or a file; for a lens, the picture a link
 * shows in place of the live one). A result's is meant for one that
 * is shown in public: until then the picture stays in the repository it was
 * made in. There is one per item; sent again, it replaces what was kept.
 */
export async function putPicture(l: Archipelago, actor: Actor, input: { result: string; data: string; content_type: string }) {
  const result = await l.entity(input.result);
  const figure = result && ['note', 'file', 'lens'].some((t) => l.registry.isA(result.type, t));
  if (!result || !(figure || l.registry.isA(result.type, 'software.test_result'))) throw new Error(`picture_put: "${input.result}" is not a test result, a note, a file or a lens.`);
  if (!PICTURE_TYPES.includes(input.content_type)) throw new Error(`picture_put: the picture must be one of ${PICTURE_TYPES.join(', ')}, not ${input.content_type}.`);
  const bytes = Buffer.from(input.data, 'base64');
  if (!bytes.length) throw new Error('picture_put: "data" is empty. Send the file as base64.');
  if (bytes.length > PICTURE_MAX) throw new Error(`picture_put: the picture is ${bytes.length} bytes; the most kept is ${PICTURE_MAX}. Make it smaller.`);
  await l.db.query(
    `insert into picture (entity_id, content_type, bytes, size) values ($1, $2, decode($3, 'base64'), $4)
     on conflict (entity_id) do update set content_type = excluded.content_type, bytes = excluded.bytes, size = excluded.size, created_at = now()`,
    [result.id, input.content_type, bytes.toString('base64'), bytes.length],
  );
  await l.log(l.db, { actor: actorId(actor), action: 'picture.stored', target: result.id, reason: `Picture kept for "${result.title}"`, detail: { size: bytes.length, content_type: input.content_type } });
  return { result: result.id, size: bytes.length, content_type: input.content_type };
}

/** The picture kept for a result, as base64, or null when none is. */
export async function getPicture(l: Archipelago, input: { result: string }) {
  const { rows } = await l.db.query<{ content_type: string; data: string; size: number }>(`select content_type, encode(bytes, 'base64') as data, size from picture where entity_id = $1`, [input.result]);
  return rows[0] ? { result: input.result, content_type: rows[0].content_type, size: rows[0].size, data: rows[0].data.replaceAll('\n', '') } : null;
}
