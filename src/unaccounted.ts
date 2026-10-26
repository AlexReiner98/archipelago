// The commits in a checkout that no one has accounted for, put to the session that starts there (the owner, 26 Oct
// 2026: every commit is accounted for before main). A commit is accounted for once the map holds a software.commit
// item for its sha (packs/github/account.js, the check on main says the same). The checkout is the hook's to read
// (scripts/pelago-hook.mjs sends its newest commits); the server only asks the map which of them it holds.

import { instructionsFor } from './instructions.ts';
import type { Archipelago } from './pelago.ts';

/** A commit as the hook sends it: its full id and its message. */
export interface SentCommit {
  id: string;
  message: string;
}

/** The most the hook reads, and the most that are named in the text; the rest are counted. */
export const MOST_READ = 40;
export const MOST_NAMED = 5;

const RUN = /^Archipelago-Run:[ \t]*([\w-]+)[ \t]*$/im;

/** The commits a body carries, whole ones only. */
export function sentCommits(sent: unknown): SentCommit[] {
  if (!Array.isArray(sent)) return [];
  return sent
    .filter((c): c is SentCommit => !!c && typeof c.id === 'string' && /^[0-9a-f]{40}$/.test(c.id) && typeof c.message === 'string')
    .slice(0, MOST_READ);
}

/** Which of these commits the map holds no commit item for, in the order sent. */
export async function unaccounted(l: Archipelago, commits: SentCommit[]): Promise<SentCommit[]> {
  if (!commits.length) return [];
  // The types that account for a commit say which field holds its id.
  const held = new Set<string>();
  for (const type of l.registry.having('accounts')) {
    const { field, accounted } = l.registry.type(type)!.capabilities.accounts!;
    // One only heard of from a push (its accounted field false) accounts for nothing yet.
    const { rows } = await l.db.query<{ sha: string }>(
      `select props->>$2 as sha from entity where type = $1 and archived_at is null and props->>$2 = any($3::text[]) and ($4::text is null or coalesce(props->>$4, 'true') <> 'false') -- index entity_type_created`,
      [type, field, commits.map((c) => c.id), accounted ?? null],
    );
    for (const r of rows) held.add(r.sha);
  }
  return commits.filter((c) => !held.has(c.id));
}

/** One commit as a line: its short id, its subject, and its run if the trailer names one. */
export function commitLine(c: SentCommit): string {
  const run = RUN.exec(c.message)?.[1];
  return `- ${c.id.slice(0, 7)} ${(c.message.split('\n')[0] ?? '').slice(0, 100)}${run ? ` (run ${run})` : ''}`;
}

/** What to tell a session about these commits (the preset `unaccounted_commits`), or nothing when all are accounted for. */
export async function unaccountedText(l: Archipelago, commits: SentCommit[], about?: string): Promise<string[]> {
  const open = await unaccounted(l, commits);
  if (!open.length) return [];
  const rest = open.length - MOST_NAMED;
  const list = [...open.slice(0, MOST_NAMED).map(commitLine), ...(rest > 0 ? [`- and ${rest} more`] : [])].join('\n');
  return (await instructionsFor(l, 'unaccounted_commits', { about, fill: { count: String(open.length), commits: list } })).map((one) => one.text);
}
