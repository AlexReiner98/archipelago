// A token limited to some repositories can read the map as its person does,
// and change only what is those repositories': what lives in them and all
// that is part of that or about it. A token that leaks, or an agent that is
// led astray by what it reads, can then reach no further than the work it
// was given. Checked here, before the tool runs. What such a token may call
// is a list: a tool that writes is on it with its check, the tools that only
// read are named, and anything else is refused.

import { repoByName, repoName } from './github.ts';
import { packTool } from './packtools.ts';
import { livesIn, scopeOf } from './places.ts';
import type { Actor, Archipelago, Op } from './pelago.ts';
import { resolveRun } from './sessions.ts';

export async function withinScope(l: Archipelago, actor: Actor, tool: string, input: Record<string, unknown>): Promise<void> {
  const repos = actor.repos ?? [];
  if (!repos.length) return;
  const scope = new Set<string>();
  for (const repo of repos) for (const id of await scopeOf(l, repo)) scope.add(id);
  await widen(l, scope);
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
      // What it touches first, then what it makes: a link to what is not there is the better reason to give.
      for (const op of [...ops.filter((o) => o.op !== 'create'), ...ops.filter((o) => o.op === 'create')]) {
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
    // A story is told of the token's own work: the run is one of a session in its repository.
    case 'tell': {
      const run = await resolveRun(l, String(input.run ?? ''));
      if (!run) return;
      const { rows } = await l.db.query(`select 1 from relation where type = any($3::text[]) and from_id = $1 and to_id = any($2::text[]) and valid_to is null`, [run.id, repos, livesIn(l)]);
      if (!rows.length) refuse(`${await named(run.id)} is not a session there, so this token cannot tell its story.`);
      return;
    }
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
      const { rows } = await l.db.query<{ from_id: string }>(`select from_id from relation where type = any($2::text[]) and to_id = $1 and valid_to is null`, [input.resource, l.registry.relationFamily('needs')]);
      if (rows.length && !rows.some((r) => scope.has(r.from_id))) refuse(`Nothing there needs ${await named(String(input.resource))}, so this token cannot ${tool} it.`);
      if (tool === 'claim') await mustBeIn(input.for, 'hold a resource for it');
      return;
    }
    case 'picture_put':
      return mustBeIn(input.result, 'keep a picture for it');
    default:
      // Everything else is refused unless it only reads: a tool added later is not open to a limited token until it is
      // named here. A pack's action is let through: what it would write is checked as a change is, before it is applied.
      if (!READS.includes(tool) && !packTool(l.registry, tool)) refuse(`It cannot call ${tool}.`);
  }
}

/** Kernel tools a limited token may call that change nothing in the map: reading it, listening for the owner, pointing their screen. A pack's views are reads too. */
const READS = ['schema', 'search', 'get', 'view', 'events', 'proposals', 'picture', 'watch', 'show', 'document'];

/**
 * What goes with the work as well: an item whose type belongs_with something in it (a test with the question it
 * helps answer, a result with its test), and so on out.
 */
async function widen(l: Archipelago, scope: Set<string>): Promise<void> {
  const rules = new Map<string, { relation: string; direction: 'out' | 'in'; types: string[] }>();
  for (const t of l.registry.types.values())
    for (const b of t.belongs_with ?? []) {
      const key = `${b.relation} ${b.direction}`;
      const rule = rules.get(key) ?? { ...b, types: [] };
      rule.types.push(t.id);
      rules.set(key, rule);
    }
  for (let grew = true, rounds = 0; grew && rounds < 4; rounds++) {
    grew = false;
    for (const { relation, direction, types } of rules.values()) {
      const [item, owner] = direction === 'out' ? ['from_id', 'to_id'] : ['to_id', 'from_id'];
      const { rows } = await l.db.query<{ id: string }>(
        `select r.${item} as id from relation r join entity e on e.id = r.${item}
         where r.type = any($1::text[]) and r.valid_to is null and r.${owner} = any($2::text[]) and e.type = any($3::text[]) and e.archived_at is null`,
        [l.registry.relationFamily(relation), [...scope], types],
      );
      for (const { id } of rows) if (!scope.has(id)) grew = Boolean(scope.add(id));
    }
  }
}
