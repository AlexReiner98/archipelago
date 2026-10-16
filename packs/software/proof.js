// Proof: the questions a user would ask before trusting the software, the tests that answer each, and what every
// test found on a build. Whether a question is answered is worked out from the results every time; nothing says so
// that could go stale. And the changelog: what a product has built or shipped, with the release each went out in.
// Asked for the public page, or from a gate, the scope is given (within): what may be shown, or what is at stake.

import { isA } from './repo.js';

const slim = (e) => ({ id: e.id, type: e.type, title: e.title, status: e.status });
const at = (e) => Date.parse(e.updated_at);

/** Everything part of these items, and the items themselves, each as read. */
async function under(ctx, ids) {
  const scope = new Map(ids.map((id) => [id, undefined]));
  for (const id of ids) for (const e of await ctx.read({ scope: id, parts: true, fields: [] })) scope.set(e.id, e);
  return scope;
}

/** The project a question belongs to: the first met going up from it, by what it is part of or about. */
async function projectOf(ctx, id) {
  const seen = new Set([id]);
  let level = [id];
  while (level.length) {
    const up = [];
    for (const x of level) for (const rel of ['part_of', 'about']) for (const e of await ctx.read({ related: x, relation: rel, fields: [] })) if (!seen.has(e.id)) (seen.add(e.id), up.push(e));
    const found = up.find((e) => isA(e, 'project'));
    if (found) return found;
    level = up.map((e) => e.id);
  }
  return undefined;
}

/**
 * The proof questions of a product (a project, a feature, anything they are part of or about), each with its tests
 * and what every test found on one build: the one asked for, or the build last reported. Without `of`, the projects
 * that have proof questions.
 */
export async function proof(input, ctx) {
  const questions = (await ctx.read({ items: { type: 'software.proof' }, fields: [] })).filter((q) => q.is_open);
  if (!input.of && !input.within) {
    const counts = new Map();
    for (const q of questions) {
      const project = await projectOf(ctx, q.id);
      if (project) counts.set(project.id, { ...slim(project), questions: (counts.get(project.id)?.questions ?? 0) + 1 });
    }
    return { products: [...counts.values()].sort((a, b) => b.questions - a.questions || a.title.localeCompare(b.title)) };
  }
  const root = input.of ? await ctx.read({ get: input.of }) : undefined;
  if (input.of && !root) throw new Error(`No entity "${input.of}"`);
  const scope = await under(ctx, input.within ?? [root.id]);
  const mine = [];
  for (const q of questions) if (scope.has(q.id) || (await ctx.read({ related: q.id, relation: 'about', fields: [] })).some((e) => scope.has(e.id))) mine.push(q);
  // Each question's tests, and each test's results, newest first.
  const tests = new Map();
  const results = new Map();
  for (const q of mine) {
    const own = (await ctx.read({ related: q.id, relation: 'software.answers', direction: 'in', fields: ['compares', 'tolerance', 'environment', 'entrypoint'] })).filter((t) => t.is_open);
    tests.set(q.id, own);
    for (const t of own)
      if (!results.has(t.id)) results.set(t.id, (await ctx.read({ related: t.id, relation: 'produced', fields: ['build', 'passed', 'value', 'picture', 'evidence'] })).filter((r) => isA(r, 'software.test_result')).sort((a, b) => at(b) - at(a)));
  }
  const all = [...results.values()].flat();
  const kept = new Set(all.length ? await ctx.read({ pictures: all.map((r) => r.id) }) : []);

  // Builds, newest report first. The page shows one build: a question is answered there or it is not.
  const reported = mine.flatMap((q) => tests.get(q.id).flatMap((t) => results.get(t.id))).sort((a, b) => at(b) - at(a));
  const builds = [...new Set(reported.map((r) => String(r.props.build ?? '')).filter(Boolean))];
  const build = input.build ?? builds[0] ?? null;
  const found = (r) => ({
    id: r.id,
    build: String(r.props.build ?? ''),
    passed: r.props.passed === true,
    value: r.props.value ?? null,
    /** Where the picture is in the repository the test ran in. */
    picture: r.props.picture ?? null,
    /** Whether the picture itself is kept here, to be had with the picture tool. */
    stored: kept.has(r.id),
    evidence: r.props.evidence ?? null,
    at: r.updated_at,
  });
  const proofs = mine
    .map((q) => {
      const shown = tests
        .get(q.id)
        .map((t) => {
          const here = results.get(t.id).find((r) => r.props.build === build);
          const before = results.get(t.id).find((r) => r.props.build !== build);
          return {
            ...slim(t),
            compares: t.props.compares ?? null,
            tolerance: t.props.tolerance ?? null,
            environment: t.props.environment ?? null,
            entrypoint: t.props.entrypoint ?? null,
            /** What it found on this build; null when it was not run there. */
            result: here ? found(here) : null,
            /** What it found on the last other build it ran on. */
            before: before ? found(before) : null,
          };
        })
        .sort((a, b) => Number(a.result?.passed ?? false) - Number(b.result?.passed ?? false) || a.title.localeCompare(b.title));
      const passed = shown.filter((t) => t.result?.passed).length;
      const failed = shown.filter((t) => t.result && !t.result.passed).length;
      return { ...slim(q), public: q.visibility === 'public', tests: shown, total: shown.length, passed, failed, not_run: shown.length - passed - failed, answered: shown.length > 0 && passed === shown.length };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
  const sum = (key) => proofs.reduce((n, p) => n + p[key], 0);
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
      .map((t) => ({ result: t.result.id, test: t.title, picture: t.result.picture })),
    how: 'A question is answered on a build when it has tests and every one passed there. To add a question: create a software.proof (the title is the question) that is part of the product or feature. To add a test: create a software.test and link it to the question with software.answers. Results come from test_report.',
  };
}

/**
 * What a product has to show for itself: its features that are built or shipped, with the release each went out in.
 * What is built and not yet released comes first, then the newest. What is only planned is not here.
 */
export async function changelog(input, ctx) {
  if (!input.of) throw new Error('changelog needs "of": the id of a project or feature.');
  const root = await ctx.read({ get: input.of });
  if (!root) throw new Error(`No entity "${input.of}"`);
  // Asked for the public page, the scope is given: what is public under the product, whatever lies between.
  const scope = input.within ? new Map(input.within.map((id) => [id, undefined])) : await under(ctx, [root.id]);
  if (!input.within) scope.delete(root.id);
  /** The release a feature went out in: its own, or that of the feature it is part of. */
  const releaseOf = async (id) => {
    const seen = new Set();
    let level = [id];
    while (level.length) {
      for (const x of level) {
        const [release] = await ctx.read({ related: x, relation: 'software.ships', direction: 'in', fields: ['version'] });
        if (release) return release;
        seen.add(x);
      }
      const up = [];
      for (const x of level) for (const p of await ctx.read({ related: x, relation: 'part_of', fields: [] })) if (!seen.has(p.id)) up.push(p.id);
      level = up;
    }
    return undefined;
  };
  const features = [];
  for (const [id, row] of scope) {
    const e = row ?? (await ctx.read({ get: id }));
    if (!e || !isA(e, 'software.feature') || (e.status !== 'built' && e.status !== 'shipped')) continue;
    const release = await releaseOf(e.id);
    features.push({ id: e.id, type: e.type, title: e.title, status: e.status, at: e.updated_at, release: release ? { id: release.id, title: release.title, status: release.status, version: release.props.version ?? null } : null });
  }
  features.sort((a, b) => Number(a.status === 'shipped') - Number(b.status === 'shipped') || Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
  return { of: slim(root), counts: { built: features.filter((f) => f.status === 'built').length, shipped: features.filter((f) => f.status === 'shipped').length }, features };
}
