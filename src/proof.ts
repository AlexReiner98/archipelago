// Proof: the questions a user would ask before trusting the software, the
// tests that answer each, and what every test found on a build. Whether a
// question is answered is worked out from the results every time; nothing
// says so that could go stale.

import { actorId, type Actor, type Entity, type Archipelago, type Op } from './pelago.ts';

interface Link {
  type: string;
  from_id: string;
  to_id: string;
}

/**
 * The proof questions of a product (a project, a feature, anything they are
 * part of or about), each with its tests and what every test found on one
 * build: the one asked for, or the build last reported. Without `of`, the
 * projects that have proof questions.
 */
export async function proof(l: Archipelago, input: { of?: string; build?: string }, within?: Set<string>) {
  const { rows: entities } = await l.db.query<Entity>(`select id, type, title, status, is_open, visibility, ${l.props}, updated_at from entity where archived_at is null`);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const { rows: links } = await l.db.query<Link>(`select type, from_id, to_id from relation where valid_to is null and type = any($1::text[])`, [['part_of', 'about', 'software.answers', 'produced']]);
  const live = links.filter((r) => byId.has(r.from_id) && byId.has(r.to_id));
  const into = (type: string, to: string) => live.filter((r) => r.type === type && r.to_id === to).map((r) => byId.get(r.from_id)!);
  const out = (type: string, from: string) => live.filter((r) => r.type === type && r.from_id === from).map((r) => byId.get(r.to_id)!);
  const isA = (e: Entity, kind: string) => l.registry.isA(e.type, kind);
  const slim = (e: Entity) => ({ id: e.id, type: e.type, title: e.title, status: e.status });
  const questions = entities.filter((e) => isA(e, 'software.proof') && e.is_open);

  if (!input.of && !within) {
    // The project a question belongs to: the first one met going up from it.
    const projectOf = (id: string) => {
      const seen = new Set([id]);
      let level = [id];
      while (level.length) {
        const up = level.flatMap((x) => [...out('part_of', x), ...out('about', x)]).filter((e) => !seen.has(e.id));
        const found = up.find((e) => isA(e, 'project'));
        if (found) return found;
        for (const e of up) seen.add(e.id);
        level = up.map((e) => e.id);
      }
      return undefined;
    };
    const counts = new Map<string, number>();
    for (const q of questions) {
      const project = projectOf(q.id);
      if (project) counts.set(project.id, (counts.get(project.id) ?? 0) + 1);
    }
    return { products: [...counts].map(([id, n]) => ({ ...slim(byId.get(id)!), questions: n })).sort((a, b) => b.questions - a.questions || a.title.localeCompare(b.title)) };
  }

  const root = input.of ? byId.get(input.of) : undefined;
  if (input.of && !root) throw new Error(`No entity "${input.of}"`);
  // Asked from a gate, the scope is given: what the event ships and what holds it.
  const scope = new Set(within ?? [root!.id]);
  const stack = [...scope];
  while (stack.length) {
    for (const kid of into('part_of', stack.pop()!)) {
      if (scope.has(kid.id)) continue;
      scope.add(kid.id);
      stack.push(kid.id);
    }
  }
  const mine = questions.filter((q) => scope.has(q.id) || out('about', q.id).some((e) => scope.has(e.id)));
  const testsOf = (q: Entity) => into('software.answers', q.id).filter((t) => t.is_open);
  const resultsOf = (t: Entity) => out('produced', t.id).filter((r) => isA(r, 'software.test_result'));
  const at = (e: Entity) => new Date(e.updated_at).getTime();
  const kept = new Set((await l.db.query<{ entity_id: string }>(`select entity_id from picture`)).rows.map((r) => r.entity_id));

  // Builds, newest report first. The page shows one build: a question is answered there or it is not.
  const reported = mine.flatMap(testsOf).flatMap(resultsOf).sort((a, b) => at(b) - at(a));
  const builds = [...new Set(reported.map((r) => String(r.props.build ?? '')).filter(Boolean))];
  const build = input.build ?? builds[0] ?? null;

  const found = (r: Entity) => ({
    id: r.id,
    build: String(r.props.build ?? ''),
    passed: r.props.passed === true,
    value: (r.props.value as string | undefined) ?? null,
    /** Where the picture is in the repository the test ran in. */
    picture: (r.props.picture as string | undefined) ?? null,
    /** Whether the picture itself is kept here, to be had with the picture tool. */
    stored: kept.has(r.id),
    evidence: (r.props.evidence as string | undefined) ?? null,
    at: r.updated_at,
  });
  const proofs = mine
    .map((q) => {
      const tests = testsOf(q)
        .map((t) => {
          const results = resultsOf(t).sort((a, b) => at(b) - at(a));
          const here = results.find((r) => r.props.build === build);
          const before = results.find((r) => r.props.build !== build);
          return {
            ...slim(t),
            compares: (t.props.compares as string | undefined) ?? null,
            tolerance: (t.props.tolerance as string | undefined) ?? null,
            environment: (t.props.environment as string | undefined) ?? null,
            entrypoint: (t.props.entrypoint as string | undefined) ?? null,
            /** What it found on this build; null when it was not run there. */
            result: here ? found(here) : null,
            /** What it found on the last other build it ran on. */
            before: before ? found(before) : null,
          };
        })
        .sort((a, b) => Number(a.result?.passed ?? false) - Number(b.result?.passed ?? false) || a.title.localeCompare(b.title));
      const passed = tests.filter((t) => t.result?.passed).length;
      const failed = tests.filter((t) => t.result && !t.result.passed).length;
      return { ...slim(q), public: q.visibility === 'public', tests, total: tests.length, passed, failed, not_run: tests.length - passed - failed, answered: tests.length > 0 && passed === tests.length };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
  const sum = (key: 'total' | 'passed' | 'failed' | 'not_run') => proofs.reduce((n, p) => n + p[key], 0);
  return {
    of: root ? slim(root) : null,
    build,
    builds: builds.slice(0, 10),
    counts: { questions: proofs.length, answered: proofs.filter((p) => p.answered).length, tests: sum('total'), passed: sum('passed'), failed: sum('failed'), not_run: sum('not_run') },
    proofs,
    /** Pictures of public results that are still only in their repository: send each with picture_put. */
    to_send: proofs
      .filter((p) => p.public)
      .flatMap((p) => p.tests)
      .filter((t) => t.result?.picture && !t.result.stored)
      .map((t) => ({ result: t.result!.id, test: t.title, picture: t.result!.picture! })),
    how: 'A question is answered on a build when it has tests and every one passed there. To add a question: create a software.proof (the title is the question) that is part of the product or feature. To add a test: create a software.test and link it to the question with software.answers. Results come from test_report.',
  };
}

/**
 * What a product has to show for itself: its features that are built or
 * shipped, with the release each went out in. What is built and not yet
 * released comes first, then the newest. What is only planned is not here.
 */
export async function changelog(l: Archipelago, input: { of?: string }, within?: Set<string>) {
  if (!input.of) throw new Error('changelog needs "of": the id of a project or feature.');
  const { rows: entities } = await l.db.query<Entity>(`select id, type, title, status, is_open, ${l.props}, updated_at from entity where archived_at is null`);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const root = byId.get(input.of);
  if (!root) throw new Error(`No entity "${input.of}"`);
  const { rows: links } = await l.db.query<Link>(`select type, from_id, to_id from relation where valid_to is null and type = any($1::text[])`, [['part_of', 'software.ships']]);
  const live = links.filter((r) => byId.has(r.from_id) && byId.has(r.to_id));
  const parents = (id: string) => live.filter((r) => r.type === 'part_of' && r.from_id === id).map((r) => r.to_id);
  const kids = (id: string) => live.filter((r) => r.type === 'part_of' && r.to_id === id).map((r) => r.from_id);
  // Asked for the public page, the scope is given: what is public under the product, whatever lies between.
  const scope = new Set<string>(within ?? []);
  const stack = within ? [] : [root.id];
  while (stack.length) {
    for (const kid of kids(stack.pop()!)) {
      if (scope.has(kid)) continue;
      scope.add(kid);
      stack.push(kid);
    }
  }
  /** The release a feature went out in: its own, or that of the feature it is part of. */
  const releaseOf = (id: string) => {
    const seen = new Set<string>();
    let level = [id];
    while (level.length) {
      for (const at of level) {
        const ships = live.find((r) => r.type === 'software.ships' && r.to_id === at);
        if (ships) return byId.get(ships.from_id)!;
        seen.add(at);
      }
      level = level.flatMap(parents).filter((x) => !seen.has(x));
    }
    return undefined;
  };
  const features = [...scope]
    .map((id) => byId.get(id)!)
    .filter((e) => l.registry.isA(e.type, 'software.feature') && (e.status === 'built' || e.status === 'shipped'))
    .map((e) => {
      const release = releaseOf(e.id);
      return {
        id: e.id,
        type: e.type,
        title: e.title,
        status: e.status,
        at: e.updated_at,
        release: release ? { id: release.id, title: release.title, status: release.status, version: (release.props.version as string | undefined) ?? null } : null,
      };
    })
    .sort((a, b) => Number(a.status === 'shipped') - Number(b.status === 'shipped') || new Date(b.at).getTime() - new Date(a.at).getTime());
  return { of: { id: root.id, type: root.type, title: root.title, status: root.status }, counts: { built: features.filter((f) => f.status === 'built').length, shipped: features.filter((f) => f.status === 'shipped').length }, features };
}

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
 * with one of its sections (a note or a file). A result's is meant for one that
 * is shown in public: until then the picture stays in the repository it was
 * made in. There is one per item; sent again, it replaces what was kept.
 */
export async function putPicture(l: Archipelago, actor: Actor, input: { result: string; data: string; content_type: string }) {
  const result = await l.entity(input.result);
  const figure = result && ['note', 'file'].some((t) => l.registry.isA(result.type, t));
  if (!result || !(figure || l.registry.isA(result.type, 'software.test_result'))) throw new Error(`picture_put: "${input.result}" is not a test result, a note or a file.`);
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
