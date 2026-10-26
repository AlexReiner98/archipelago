// `npm run principles`: the facts a principle's page draws that live in code, read in rather than typed, so they cannot
// drift from it: each pack's rules, every action an agent can call, and every test. Each item is found again by
// props.key (where it lives in the code) and changed only when what was read of it has (props.digest); one the code
// no longer has is retired. Which principle each one serves is said on the map, by a serves link: this never touches
// links. With the map's address in PELAGO_URL and an agent's token in PELAGO_TOKEN; --into <id> names what new items
// are part of, --dry prints the change instead of sending it.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TYPES = ['software.rule', 'software.action', 'software.test'] as const;

/** One fact as read from the code: what its item should say. */
export interface Read {
  type: (typeof TYPES)[number];
  key: string;
  title: string;
  body: string;
  props: Record<string, unknown>;
}

/** An item of one of those types as the map holds it. */
export interface Kept {
  id: string;
  type: string;
  status: string;
  fields?: { key?: string; digest?: string };
}

const MAX_TITLE = 60;
const cut = (s: string) => (s.length <= MAX_TITLE ? s : s.slice(0, MAX_TITLE - 1).trimEnd() + '…');
export const digestOf = (r: Read) => createHash('sha256').update(JSON.stringify([r.type, r.title, r.body, r.props])).digest('hex').slice(0, 12);

interface PackRule {
  id: string;
  then?: unknown;
  say?: string;
  lifted?: string;
}
interface PackAction {
  id: string;
  verb: string;
  title?: string;
  description?: string;
}

/** The rules a pack file keeps, each by its pack and id. */
export function rulesOf(pack: { id: string; rules?: PackRule[] }): Read[] {
  return (pack.rules ?? []).map((r) => ({
    type: 'software.rule',
    key: `${pack.id}/${r.id}`,
    title: cut(`${r.id} (${pack.id})`),
    body: r.say ?? '',
    props: { pack: pack.id, then: typeof r.then === 'string' ? r.then : JSON.stringify(r.then ?? null), ...(r.lifted && { lifted: r.lifted }) },
  }));
}

/** The actions a pack file declares, and the kernel's own, each by its verb and name. */
export function actionsOf(packs: { id: string; actions?: PackAction[] }[], kernel: { name: string; verb: string; description: string }[]): Read[] {
  const one = (name: string, verb: string, pack: string, description: string): Read => ({
    type: 'software.action',
    key: `${verb}/${name}`,
    title: cut(`${verb} ${name}`),
    body: description,
    props: { verb, pack },
  });
  return [
    ...kernel.map((k) => one(k.name, k.verb, 'kernel', k.description)),
    // A pack's action for each verb is declared in its pack file; the six verbs themselves are core's, not actions.
    ...packs.flatMap((p) => (p.actions ?? []).filter((a) => a.verb).map((a) => one(a.id, a.verb, p.id, a.description ?? a.title ?? ''))),
  ];
}

/** The tests one test file declares, by the name each is given: test('…', …) with a plain string. */
export function testsOf(file: string, source: string): Read[] {
  const found: Read[] = [];
  for (const m of source.matchAll(/^\s*test\(\s*(['"`])((?:\\.|(?!\1).)*)\1/gm)) {
    if (m[1] === '`' && m[2].includes('${')) continue;
    const name = m[2].replace(/\\(.)/g, '$1');
    found.push({ type: 'software.test', key: `${file}: ${name}`, title: cut(name), body: `${name}\n\nIn ${file}.`, props: { executable: true, entrypoint: `node --test ${file}` } });
  }
  return found;
}

/**
 * The change that brings the map in line with what was read: a new fact made, a changed one updated, one gone retired.
 * Items with no key (a proof's tests typed by hand) are not this script's and are left alone.
 */
export function principlesChange(read: Read[], kept: Kept[], into?: string) {
  const byKey = new Map(kept.filter((k) => k.fields?.key).map((k) => [k.fields!.key!, k]));
  const ops: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  read.forEach((r, i) => {
    if (seen.has(r.key)) return;
    seen.add(r.key);
    const props = { ...r.props, key: r.key, digest: digestOf(r) };
    const old = byKey.get(r.key);
    if (!old) {
      ops.push({ op: 'create', ref: `f${i}`, type: r.type, title: r.title, body: r.body, status: 'current', visibility: 'shared', props });
      if (into) ops.push({ op: 'link', type: 'part_of', from: `f${i}`, to: into });
    } else if (old.fields?.digest !== props.digest || old.status !== 'current') {
      ops.push({ op: 'update', id: old.id, title: r.title, body: r.body, status: 'current', props });
    }
  });
  for (const [key, k] of byKey) if (!seen.has(key) && k.status !== 'retired' && (TYPES as readonly string[]).includes(k.type)) ops.push({ op: 'update', id: k.id, status: 'retired' });
  return ops;
}

/** Everything this checkout says: the packs' rules and actions, the kernel's actions, and the tests. */
export async function readHere(root: string): Promise<Read[]> {
  const packDirs = readdirSync(join(root, 'packs'), { withFileTypes: true }).filter((d) => d.isDirectory());
  const packs = packDirs.flatMap((d) => {
    try {
      return [JSON.parse(readFileSync(join(root, 'packs', d.name, 'pack.json'), 'utf8'))];
    } catch {
      return [];
    }
  });
  const { KERNEL_VERBS } = await import('../src/declared.ts');
  const { TOOLS } = await import('../src/tools.ts');
  const kernel = Object.entries(KERNEL_VERBS)
    .filter(([name]) => TOOLS[name] && !TOOLS[name].humanOnly)
    .map(([name, verb]) => ({ name, verb, description: TOOLS[name].description }));
  const testFiles = [
    ...readdirSync(join(root, 'test')).filter((f) => f.endsWith('.test.ts')).map((f) => `test/${f}`),
    ...packDirs.flatMap((d) => readdirSync(join(root, 'packs', d.name)).filter((f) => f.endsWith('.test.ts')).map((f) => `packs/${d.name}/${f}`)),
  ].sort();
  return named([...packs.flatMap(rulesOf), ...actionsOf(packs, kernel), ...testFiles.flatMap((f) => testsOf(f, readFileSync(join(root, f), 'utf8')))]);
}

/** Two tests of one name in different files are told apart by their file, so no title is said twice. */
export function named(read: Read[]): Read[] {
  const count = new Map<string, number>();
  for (const r of read) count.set(r.title, (count.get(r.title) ?? 0) + 1);
  return read.map((r) => {
    if (count.get(r.title)! < 2 || r.type !== 'software.test') return r;
    const [file, ...name] = r.key.split(': ');
    const where = ` (${file.split('/').pop()!.replace(/\.test\.ts$/, '')})`;
    const base = name.join(': ');
    const room = MAX_TITLE - where.length;
    return { ...r, title: (base.length <= room ? base : base.slice(0, room - 1).trimEnd() + '…') + where };
  });
}

if (import.meta.main) {
  const root = join(import.meta.dirname, '..');
  const arg = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
  const [base, token] = [process.env.PELAGO_URL, process.env.PELAGO_TOKEN];
  if (!base || !token) throw new Error('Set PELAGO_URL to the map and PELAGO_TOKEN to an agent token for it.');
  const commit = process.env.GITHUB_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const call = async (tool: string, input: unknown) => {
    const res = await fetch(`${base.replace(/\/$/, '')}/agent/${tool}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
    const answer = (await res.json()) as { result?: unknown; error?: string };
    if (answer.error) throw new Error(`${tool}: ${answer.error}`);
    return answer.result;
  };
  const answer = (await call('query', { name: 'flat', params: { filter: { types: [...TYPES], exclude: [] }, limit: 2000, full: true } })) as { items: Kept[]; cut?: boolean };
  if (answer.cut) throw new Error('More than 2000 rules, actions and tests on the map: the lens cut them, so nothing is sent.');
  const read = await readHere(root);
  const ops = principlesChange(read, answer.items, arg('--into'));
  const counts = { read: read.length, made: ops.filter((o) => o.op === 'create').length, changed: ops.filter((o) => o.op === 'update' && o.status === 'current').length, retired: ops.filter((o) => o.status === 'retired').length };
  if (!ops.length) console.log(`Nothing moved: the map holds what the code says at ${commit.slice(0, 7)}.`, counts);
  else if (process.argv.includes('--dry')) console.log(JSON.stringify({ counts, ops: ops.slice(0, 20) }, null, 1));
  else {
    const result = await call('change', { ops, reason: `Rules, actions and tests read from the code at ${commit.slice(0, 7)}`, authority: { of: 'agent', basis: `npm run principles at ${commit}` }, source: { uri: commit, kind: 'commit' } });
    console.log(counts, JSON.stringify(result).slice(0, 400));
  }
}
