// An island's findings, one row each, as an agent and a person read them alike (task e_p27ddjqt; question e_5xg2xd7q):
// the claim (its title), its value with its unit, how sure (confidence), as of when, and how many read it. A finding is
// an item of a type that promises fields to its readers (the `promised` capability); the kernel names no such type.
// Read by `brief` of an island (src/brief.ts) and drawn on the island's page from that same answer (ui/findings.js).

import { promisedTypes, readingTypes } from './moved.ts';
import type { Archipelago } from './pelago.ts';

/** One finding as a row: what it claims, its value as said (with its unit), how sure, as of when, how many read it. */
export interface FindingRow {
  id: string;
  title: string;
  value?: string;
  confidence: number;
  as_of?: string;
  readers: number;
}

/** How many findings a brief lists of one island; what is past it is counted. */
export const FINDINGS_LIMIT = 40;

/** A value as it is read: a yes or no for a boolean, the number or text as written, its unit after it when one is said. */
export function valueText(props: Record<string, unknown>): string | undefined {
  const v = props.value;
  if (v === undefined || v === null || v === '') return undefined;
  const said = typeof v === 'boolean' || props.value_type === 'boolean' ? (v === true || v === 'true' ? 'yes' : v === false || v === 'false' ? 'no' : String(v)) : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const unit = typeof props.unit === 'string' && props.unit.trim() ? props.unit.trim() : '';
  return unit ? `${said} ${unit}` : said;
}

/** The open findings that live on an island, most read first, then newest: rows, and how many more there are. */
export async function islandFindings(l: Archipelago, island: string, limit = FINDINGS_LIMIT): Promise<{ rows: FindingRow[]; more: number }> {
  const kinds = promisedTypes(l);
  if (!kinds.length) return { rows: [], more: 0 };
  const { rows } = await l.db.query<{ id: string; title: string; props: Record<string, unknown>; confidence: number | null; updated_at: Date }>(
    `select e.id, e.title, e.props, e.confidence, e.updated_at from entity e
     where e.props->>'island' = $1 and e.type = any($2::text[]) and e.is_open and e.archived_at is null -- index entity_island`,
    [island, kinds],
  );
  const reading = readingTypes(l);
  const ids = rows.map((r) => r.id);
  const counts = new Map(
    ids.length && reading.length
      ? (await l.db.query<{ to_id: string; n: number }>(`select to_id, count(*)::int as n from relation where to_id = any($1::text[]) and type = any($2::text[]) and valid_to is null group by to_id`, [ids, reading])).rows.map((r) => [r.to_id, r.n])
      : [],
  );
  const asOf = (p: Record<string, unknown>) => (typeof p.as_of === 'string' && p.as_of ? p.as_of.slice(0, 10) : undefined);
  const all: FindingRow[] = rows.map((r) => ({ id: r.id, title: r.title, value: valueText(r.props), confidence: r.confidence ?? 1, as_of: asOf(r.props), readers: counts.get(r.id) ?? 0 }));
  const when = (f: FindingRow) => f.as_of ?? '';
  all.sort((a, b) => b.readers - a.readers || when(b).localeCompare(when(a)) || a.title.localeCompare(b.title));
  return { rows: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}

/** A finding as one line of text: the claim, its value, how sure (said only when less than sure), as of when, how many read it, and its id to act on. */
export const findingLine = (f: FindingRow) =>
  `- ${f.title}${f.value !== undefined ? `: ${f.value}` : ': (no value)'}${f.confidence < 1 ? ` · sure ${f.confidence}` : ''} · ${f.as_of ? `as of ${f.as_of}` : 'no date'} · ${f.readers} read · ${f.id}`;
