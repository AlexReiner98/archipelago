// Only's plain words (decision e_xe5dx55e): what must hold of a seed beyond its type, written as short words read like
// a link term, the same in the bar, the address and an agent's lens. done · blocked · status <s> ·
// no owner · over estimate · changed since|before <7d|date> · made since|before <7d|date> · by owner · by agent.
// A since and a before together are a range: made since 2026-10-13 and made before 2026-10-14 is what was made that day.
//
// Most are a condition on the item's row, read by the reads API (flat). Blocked is what attention means by it (depends on
// something open, waits on someone, needs a resource unavailable or held); by owner and by agent read the authority
// the log keeps on the change that last set the item's status (docs/log.md). Those two are checked on the ids a read
// found, never over the map.

import { dayStart } from './timeaxis.ts';

export type Word =
  | { word: 'done' | 'blocked' | 'no owner' | 'over estimate' | 'by owner' | 'by agent' }
  | { word: 'status'; status: string }
  | { word: TimeWord; at: Date | string };

type TimeWord = 'changed since' | 'made since' | 'changed before' | 'made before';

const DAY = 86_400_000;
const PLAIN = ['done', 'blocked', 'no owner', 'over estimate', 'by owner', 'by agent'] as const;
/** The words that take something after them. */
const TAKES = /^(status|(?:changed|made) (?:since|before))(?:\s+(.*))?$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A time a word says: so many days ago (7d), a date (its day begins in the workspace's zone, worked out with the
 * condition), or a date-time. */
function timeOf(said: string, now: number): Date | string | null {
  const days = /^(\d+)\s*d$/i.exec(said);
  if (days) return new Date(now - Number(days[1]) * DAY);
  if (DATE.test(said)) return Number.isNaN(Date.parse(said)) ? null : said;
  return /^\d{4}-\d{2}-\d{2}T/.test(said) && !Number.isNaN(Date.parse(said)) ? new Date(said) : null;
}

/** An Only term read as a word; undefined when it is no word (a type, then). A word written wrong is refused. */
export function readWord(term: string, now = Date.now()): Word | undefined {
  const s = term.trim().replace(/\s+/g, ' ');
  const plain = PLAIN.find((w) => w === s.toLowerCase());
  if (plain) return { word: plain };
  const [, head, rest = ''] = TAKES.exec(s) ?? [];
  if (!head) return undefined;
  const word = head.toLowerCase() as 'status' | TimeWord;
  if (!rest.trim()) throw new Error(`filter.only: "${word}" needs what follows it (${word === 'status' ? 'status todo' : `${word} 7d, or a date`})`);
  if (word === 'status') return { word, status: rest.trim() };
  const at = timeOf(rest.trim(), now);
  if (!at) throw new Error(`filter.only: "${s}": a time is so many days (7d) or a date (2026-10-01)`);
  return { word, at };
}

/** Whether any word is checked on what a read found rather than in it: then a read finds more, for these to keep. */
export const checkedAfter = (words: Word[]) => words.some((w) => w.word === 'blocked' || w.word === 'by owner' || w.word === 'by agent');

/** A word with its time as an instant: a date said is the start of its day in the workspace's zone (the reads API reads instants). */
export const atInstant = (w: Word, zone: string | null): Word => ('at' in w && typeof w.at === 'string' ? { ...w, at: new Date(dayStart(w.at, zone!)) } : w);

/** Whether any word says a day, so the workspace's zone is read to work it out. */
export const saysDay = (words: Word[]) => words.some((w) => 'at' in w && typeof w.at === 'string');
