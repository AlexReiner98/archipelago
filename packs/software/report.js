// What a test run found, on one build: the software pack's test_report action. One result is kept for each test on
// each build: reported again, it is replaced. A test the map does not know is named in the answer and nothing is
// made for it, so a harness cannot fill the map with tests nobody placed under a question. A test run again loses
// the pictures kept for its results (the kernel drops them once the change is applied), and where a test answers a
// public question the answer names the pictures to send now.

export async function testReport(input, ctx) {
  const build = String(input.build ?? '').trim();
  if (!build) throw new Error('test_report needs "build": the version or commit the tests ran on.');
  const tests = await ctx.read({ items: { type: 'software.test' } });
  const find = (key) => tests.find((t) => t.id === key) ?? tests.find((t) => t.props?.entrypoint === key);
  const today = ctx.now.slice(0, 10);
  const ops = [];
  const unknown = [];
  const seen = new Map();
  let passed = 0;
  let failed = 0;
  for (const [i, r] of input.results.entries()) {
    const test = find(r.test);
    if (!test) {
      unknown.push(r.test);
      continue;
    }
    if (seen.has(test.id)) throw new Error(`test_report: "${r.test}" is reported twice for build ${build}.`);
    const results = await ctx.read({ related: test.id, relation: 'produced', types: ['software.test_result'], fields: ['build'] });
    if (r.passed) passed++;
    else failed++;
    const before = results.find((k) => k.props?.build === build);
    const id = before?.id ?? `result${i}`;
    seen.set(test.id, { results: results.map((k) => k.id), id: before ? id : `{${id}}`, picture: r.picture });
    if (before) {
      // What the last run said and this one does not is cleared, not left standing.
      ops.push({ op: 'update', id, status: 'recorded', props: { passed: r.passed, measured_on: today, value: r.value ?? null, evidence: r.evidence ?? null, picture: r.picture ?? null } });
      continue;
    }
    const props = { build, passed: r.passed, measured_on: today };
    if (r.value !== undefined) props.value = r.value;
    if (r.evidence !== undefined) props.evidence = r.evidence;
    if (r.picture !== undefined) props.picture = r.picture;
    ops.push({ op: 'create', ref: id, type: 'software.test_result', title: `${build}: ${test.title}`.slice(0, 60), props }, { op: 'link', type: 'produced', from: test.id, to: id });
  }
  if (!ops.length) return { answer: { build, recorded: 0, passed, failed, unknown } };
  // A public result shows its picture, and the picture is where the test ran: say which are owed.
  const sendPictures = [];
  for (const [test, kept] of seen) {
    if (!kept.picture) continue;
    const questions = await ctx.read({ related: test, relation: 'software.answers', types: ['software.proof'], fields: [] });
    if (questions.some((q) => q.visibility === 'public')) sendPictures.push({ result: kept.id, picture: kept.picture });
  }
  return {
    ops,
    reason: `Test results for build ${build}: ${passed} passed, ${failed} failed${input.link ? ` (${input.link})` : ''}`,
    // A test that is run again loses the pictures kept for its results: they no longer show what it found.
    drop_pictures: [...seen.values()].flatMap((k) => k.results),
    answer: { build, recorded: seen.size, passed, failed, unknown, send_pictures: sendPictures },
  };
}
