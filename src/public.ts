// The public page of a product: what anyone may see with no login. Everything
// here is read through the database as the public role sees it, so what is
// not public cannot be given away by a mistake in this file: it is not there
// to be read. What this file adds is restraint in what it passes on of what
// is there: names, states and what the tests found, and nothing else.

import type { Entity, Archipelago } from './pelago.ts';
import { changelog, proof } from './proof.ts';

/**
 * A public product (public work: a project or a feature), as its page shows it: the proof
 * questions asked of it with their tests and what each found on one build,
 * and its changelog. Null when there is no such public product.
 */
export async function publicPage(l: Archipelago, product: string, build?: string) {
  const pub = l.forAnyone();
  const { rows } = await pub.db.query<Entity>(`select id, type, title, status from entity where id = $1 and visibility = 'public' and archived_at is null`, [product]);
  const root = rows[0];
  const type = root && l.registry.type(root.type);
  if (!type?.public || type.kind !== 'work') return null;
  // Everything public that belongs to it, through whatever lies between that is not.
  const under = new Set([root.id, ...(await pub.db.query<{ id: string }>(`select pelago_public_under($1) as id`, [root.id])).rows.map((r) => r.id)]);
  const proven = await proof(pub, { build }, under);
  const log = await changelog(pub, { of: root.id }, under);
  return {
    title: root.title,
    build: proven.build ?? null,
    builds: proven.builds ?? [],
    counts: proven.counts ?? { questions: 0, answered: 0, tests: 0, passed: 0, failed: 0, not_run: 0 },
    questions: (proven.proofs ?? []).map((q) => ({
      id: q.id,
      title: q.title,
      total: q.total,
      passed: q.passed,
      failed: q.failed,
      not_run: q.not_run,
      answered: q.answered,
      tests: q.tests.map((t) => ({
        id: t.id,
        title: t.title,
        compares: t.compares,
        tolerance: t.tolerance,
        environment: t.environment,
        written: t.status !== 'draft',
        result: t.result && { passed: t.result.passed, value: t.result.value, build: t.result.build, at: t.result.at, picture: t.result.stored ? t.result.id : null },
        before: t.before && { build: t.before.build, passed: t.before.passed },
      })),
    })),
    changelog: log.features.map((f) => ({ title: f.title, status: f.status, at: f.at, release: f.release && { title: f.release.title, version: f.release.version } })),
  };
}

/** The picture kept for a public result, or null: one that is not public is not there for this to find. */
export async function publicPicture(l: Archipelago, result: string): Promise<{ content_type: string; bytes: Buffer } | null> {
  const { rows } = await l.forAnyone().db.query<{ content_type: string; data: string }>(`select content_type, encode(bytes, 'base64') as data from picture where entity_id = $1`, [result]);
  return rows[0] ? { content_type: rows[0].content_type, bytes: Buffer.from(rows[0].data, 'base64') } : null;
}
