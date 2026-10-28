// Only's plain words (decision e_xe5dx55e), as the bar says and offers them: done, blocked, status <s>, owner me|<person>,
// no owner, over estimate, changed since <7d|date>, made since <7d|date>, by owner, by agent. The server reads them
// (src/lens-only.ts); here they are told from a type, said with names for ids, and offered in Only's menu.

/** Whether an Only term is one of the words (else it is a type). */
export const isWord = (term) => /^(done|blocked|no owner|over estimate|by owner|by agent)$|^(status|owner|changed since|made since)\s+\S/i.test(term.trim());

/** An Only term in words: a word as it is written, a person it names by their name; a type by its title. */
export const onlySaid = (term, typeTitle, nameOf) => {
  if (!isWord(term)) return typeTitle(term);
  const [, who] = /^owner\s+(e_[a-z0-9]{8})$/i.exec(term.trim()) ?? [];
  return who ? `owner ${nameOf(who)}` : term;
};

/** What each word keeps, for its tooltip. */
const MEANS = {
  done: 'What is done or closed',
  blocked: 'What waits on something open, someone, or a resource that is not free',
  'no owner': 'What nobody owns',
  'owner me': 'What is mine',
  'over estimate': 'What has used more tokens than it was estimated to take',
  'by owner': 'What the owner last set the status of, or an agent on their word',
  'by agent': 'What an agent last set the status of, on its own judgment',
};

/** The words Only's menu offers, those already in the lens left out; `days` is how far back changed and made since look. */
export function offered(have, days) {
  const since = (word) => ({ [`${word} since ${days}d`]: `What was ${word} in the last ${days} days` });
  return Object.entries({ done: MEANS.done, blocked: MEANS.blocked, 'owner me': MEANS['owner me'], 'no owner': MEANS['no owner'], ...since('changed'), ...since('made'), 'over estimate': MEANS['over estimate'], 'by owner': MEANS['by owner'], 'by agent': MEANS['by agent'] })
    .filter(([word]) => !have.includes(word))
    .map(([word, title]) => ({ word, title }));
}
