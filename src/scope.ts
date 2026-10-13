// A token limited to some repositories can read the map as its person does,
// and change only what is those repositories': what lives in them and all
// that is part of that or about it. A token that leaks, or an agent that is
// led astray by what it reads, can then reach no further than the work it
// was given. Checked here, before the tool runs. What such a token may call
// is a list: a tool that writes is on it with its check, the tools that only
// read are named, and anything else is refused.

import { repoByName, repoName } from './github.ts';
import type { Actor, Lattice, Op } from './lattice.ts';
import { repoScope } from './views.ts';

export async function withinScope(l: Lattice, actor: Actor, tool: string, input: Record<string, unknown>): Promise<void> {
  const repos = actor.repos ?? [];
  if (!repos.length) return;
  const scope = new Set<string>();
  for (const repo of repos) for (const id of await repoScope(l, repo)) scope.add(id);
  const titles = (await Promise.all(repos.map(async (id) => (await l.entity(id))?.title ?? id))).join(' and ');
  const refuse = (what: string): never => {
    throw new Error(`This token is limited to the work of ${titles}. ${what}`);
  };
  const named = async (id: string) => `"${(await l.entity(id))?.title ?? id}"`;
  const mustBeIn = async (id: unknown, doing: string) => {
    if (typeof id === 'string' && !scope.has(id)) refuse(`${await named(id)} is not part of it, so this token cannot ${doing}.`);
  };
  const isRepo = async (given: unknown) => {
    const id = typeof given === 'string' && /^e_[a-z0-9]{8}$/.test(given) ? given : (await repoByName(l, repoName(String(given ?? ''))))?.id;
    if (!id || !repos.includes(id)) refuse('It cannot speak for another repository.');
  };

  switch (tool) {
    case 'change': {
      const ops = (input.ops ?? []) as Op[];
      // What a change makes is in scope once it is tied, in the same change, to something that is.
      const made = new Set(ops.flatMap((op) => (op.op === 'create' && op.ref ? [op.ref] : [])));
      const tied = new Set<string>();
      const inside = (key: string) => scope.has(key) || tied.has(key);
      for (let grew = true; grew; ) {
        grew = false;
        for (const op of ops) {
          if (op.op !== 'link') continue;
          for (const [mine, other] of [[op.from, op.to], [op.to, op.from]]) {
            if (!made.has(mine) || tied.has(mine) || !inside(other)) continue;
            tied.add(mine);
            grew = true;
          }
        }
      }
      for (const op of ops) {
        if (op.op === 'create' && !(op.ref && tied.has(op.ref))) refuse(`"${op.title}" is made without being tied to anything there: give it a ref and link it (is part of, is about) to something of that work in the same change.`);
        if (op.op === 'update') await mustBeIn(op.id, 'change it');
        if (op.op === 'archive' || op.op === 'restore') await mustBeIn(op.id, `${op.op} it`);
        if (op.op === 'link' && !made.has(op.from)) await mustBeIn(op.from, 'change what it is linked to');
        if (op.op === 'merge') {
          await mustBeIn(op.keep, 'merge it');
          await mustBeIn(op.drop, 'merge it');
        }
        if (op.op === 'unlink') {
          const { rows } = await l.db.query<{ from_id: string }>(`select from_id from relation where id = $1`, [op.relation]);
          if (rows[0]) await mustBeIn(rows[0].from_id, 'change what it is linked to');
        }
        if (op.op === 'define_type') refuse('It cannot define a type: that changes the whole map.');
      }
      return;
    }
    case 'undo': {
      const { rows } = await l.db.query<{ target_id: string | null }>(`select distinct target_id from event where changeset = $1`, [input.changeset]);
      for (const row of rows) if (row.target_id) await mustBeIn(row.target_id, 'undo a change to it');
      return;
    }
    case 'session_start':
    case 'session_update':
      return mustBeIn(input.task, 'take it on');
    case 'session_end':
      for (const id of (input.still_true ?? []) as string[]) await mustBeIn(id, 'vouch for it');
      return;
    case 'rechecked':
    case 'run_report':
      return isRepo(input.repo);
    case 'notify':
      return mustBeIn(input.about, 'send a notification about it');
    // A resource is taken or given back for work: one that something of this work needs, or one no work is said to
    // need (a lane everyone shares). One that only other work needs is that work's.
    case 'claim':
    case 'release': {
      const { rows } = await l.db.query<{ from_id: string }>(`select from_id from relation where type = 'needs' and to_id = $1 and valid_to is null`, [input.resource]);
      if (rows.length && !rows.some((r) => scope.has(r.from_id))) refuse(`Nothing there needs ${await named(String(input.resource))}, so this token cannot ${tool} it.`);
      if (tool === 'claim') await mustBeIn(input.for, 'hold a resource for it');
      return;
    }
    // A test is this work's when it is part of it, or helps answer a question that is; a result is its test's.
    case 'test_report': {
      const { rows: tests } = await l.db.query<{ id: string; entrypoint: string | null }>(`select id, props->>'entrypoint' as entrypoint from entity where type = any($1::text[]) and archived_at is null`, [l.registry.family('software.test')]);
      const mine = await testsOf(l, scope);
      for (const result of (input.results ?? []) as { test: string }[]) {
        // Found as the report itself finds it: by id, then by the name the harness knows it by. One the map does not know is not recorded at all.
        const test = tests.find((t) => t.id === result.test) ?? tests.find((t) => t.entrypoint === result.test);
        if (test && !mine.has(test.id)) refuse(`${await named(test.id)} is not a test of it, so this token cannot report what it found.`);
      }
      return;
    }
    case 'picture_put': {
      const { rows } = await l.db.query<{ from_id: string }>(`select from_id from relation where type = 'produced' and to_id = $1 and valid_to is null`, [input.result]);
      const mine = await testsOf(l, scope);
      if (!rows.some((r) => mine.has(r.from_id))) refuse(`${await named(String(input.result))} is not the result of a test of it, so this token cannot keep a picture for it.`);
      return;
    }
    default:
      // Everything else is refused unless it only reads: a tool added later is not open to a limited token until it is named here.
      if (!READS.includes(tool)) refuse(`It cannot call ${tool}.`);
  }
}

/** What a limited token may call that changes nothing in the map: reading it, listening for the owner, pointing their screen. */
const READS = ['schema', 'search', 'get', 'view', 'events', 'proposals', 'picture', 'watch', 'show'];

/** The tests of some work: those in it, and those that help answer a proof question in it. */
async function testsOf(l: Lattice, scope: Set<string>): Promise<Set<string>> {
  const { rows } = await l.db.query<{ id: string; question: string | null }>(
    `select e.id, a.to_id as question from entity e left join relation a on a.from_id = e.id and a.type = 'software.answers' and a.valid_to is null
     where e.type = any($1::text[]) and e.archived_at is null`,
    [l.registry.family('software.test')],
  );
  return new Set(rows.filter((r) => scope.has(r.id) || (r.question !== null && scope.has(r.question))).map((r) => r.id));
}
