// Proof: the questions a user would ask before trusting the software, the
// tests that answer each, and what every test found on a build. Whether a
// question is answered is worked out from the results every time; nothing
// says so that could go stale.

import type { Actor, Entity, Lattice, Op } from './lattice.ts';

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
export async function proof(l: Lattice, input: { of?: string; build?: string }) {
  const { rows: entities } = await l.db.query<Entity>(`select id, type, title, status, is_open, props, updated_at from entity where archived_at is null`);
  const byId = new Map(entities.map((e) => [e.id, e]));
  const { rows: links } = await l.db.query<Link>(`select type, from_id, to_id from relation where valid_to is null and type = any($1::text[])`, [['part_of', 'about', 'software.answers', 'produced']]);
  const live = links.filter((r) => byId.has(r.from_id) && byId.has(r.to_id));
  const into = (type: string, to: string) => live.filter((r) => r.type === type && r.to_id === to).map((r) => byId.get(r.from_id)!);
  const out = (type: string, from: string) => live.filter((r) => r.type === type && r.from_id === from).map((r) => byId.get(r.to_id)!);
  const isA = (e: Entity, kind: string) => l.registry.isA(e.type, kind);
  const slim = (e: Entity) => ({ id: e.id, type: e.type, title: e.title, status: e.status });
  const questions = entities.filter((e) => isA(e, 'software.proof') && e.is_open);

  if (!input.of) {
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

  const root = byId.get(input.of);
  if (!root) throw new Error(`No entity "${input.of}"`);
  const scope = new Set([root.id]);
  const stack = [root.id];
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

  // Builds, newest report first. The page shows one build: a question is answered there or it is not.
  const reported = mine.flatMap(testsOf).flatMap(resultsOf).sort((a, b) => at(b) - at(a));
  const builds = [...new Set(reported.map((r) => String(r.props.build ?? '')).filter(Boolean))];
  const build = input.build ?? builds[0] ?? null;

  const found = (r: Entity) => ({
    id: r.id,
    build: String(r.props.build ?? ''),
    passed: r.props.passed === true,
    value: (r.props.value as string | undefined) ?? null,
    picture: (r.props.picture as string | undefined) ?? null,
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
      return { ...slim(q), tests, total: tests.length, passed, failed, not_run: tests.length - passed - failed, answered: tests.length > 0 && passed === tests.length };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
  const sum = (key: 'total' | 'passed' | 'failed' | 'not_run') => proofs.reduce((n, p) => n + p[key], 0);
  return {
    of: slim(root),
    build,
    builds: builds.slice(0, 10),
    counts: { questions: proofs.length, answered: proofs.filter((p) => p.answered).length, tests: sum('total'), passed: sum('passed'), failed: sum('failed'), not_run: sum('not_run') },
    proofs,
    how: 'A question is answered on a build when it has tests and every one passed there. To add a question: create a software.proof (the title is the question) that is part of the product or feature. To add a test: create a software.test and link it to the question with software.answers. Results come from test_report.',
  };
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
export async function reportTests(l: Lattice, actor: Actor, input: TestReport) {
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
  return { status: result.status, build, recorded: seen.size, passed, failed, unknown };
}
