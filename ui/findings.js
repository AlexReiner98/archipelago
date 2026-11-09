// An island's findings on its page, one line each: the claim, its value with its unit, how sure (a mark only when it
// is not sure), how old (from as of), and how many read it (task e_p27ddjqt). The rows are the `brief` of the island,
// the same answer an agent reads (src/findings.ts), so a person and an agent see one list.

import { api, h } from './base.js';
import { day } from './words.js';

/** How long ago a day was, in days: today, yesterday, a few days, then the date. */
function age(asOf) {
  if (!asOf) return h('span', { class: 'ago muted', title: 'No date: as of when is not said' }, '—');
  const then = new Date(`${asOf}T12:00`);
  const days = Math.round((Date.now() - then.getTime()) / 86_400_000);
  const text = days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 14 ? `${days} d` : day(asOf, 'medium');
  return h('span', { class: 'ago', title: `As of ${day(asOf, 'long')}` }, text);
}

/** How sure, as a mark: nothing to say when it is sure; a share when it is less, in the warning tone. */
const sure = (c) => (c >= 1 ? h('span', { class: 'find-sure' }) : h('span', { class: 'mark warn find-sure', title: `Confidence ${c}` }, `${Math.round(c * 100)}%`));

/** How many read it: a count, muted when none does. */
const readers = (n) => h('span', { class: `find-readers${n ? '' : ' muted'}`, title: n === 1 ? 'One item reads it' : `${n} items read it` }, `⇠${n}`);

function row(f) {
  const tip = `${f.title}${f.value !== undefined ? `\n${f.value}` : ''}`;
  return h(
    'li',
    { class: 'finding-row' },
    h('a', { class: 'find-claim', href: `#/e/${f.id}`, title: tip }, f.title),
    f.value !== undefined ? h('span', { class: 'find-value', title: f.value }, f.value) : h('span', { class: 'find-value muted', title: 'No value given' }, '—'),
    sure(f.confidence),
    age(f.as_of),
    readers(f.readers),
  );
}

/** Rows as a list, with how many more there are past them. */
const list = (rows, more) => h('ul', { class: 'findings' }, rows.map(row), more > 0 && h('li', { class: 'muted small turn-more' }, `${more} more`));

/**
 * The island's findings in place of `host`: a section of its page, what it stands by (published) first, its working
 * findings folded under them. Left out when it has none of either.
 */
export async function findingsPiece(host, island, section) {
  const answer = await api('view', { name: 'brief', params: { task: island.id } });
  const rows = answer?.findings ?? [];
  const working = answer?.working ?? [];
  if (!rows.length && !working.length) return host.remove();
  const more = answer.findings_more ?? 0;
  const workingMore = answer.working_more ?? 0;
  const folded =
    working.length > 0 &&
    h(
      'details',
      { class: 'find-working' },
      h('summary', { title: 'Working findings: read on this island only, until it marks them published' }, 'Working', h('span', { class: 'n' }, `${working.length + workingMore}`)),
      list(working, workingMore),
    );
  host.replaceWith(section('findings', 'Published', `${rows.length + more}`, rows.length ? list(rows, more) : h('p', { class: 'muted small find-none' }, 'None marked published'), folded));
}
