// Only's plain words (decision e_xe5dx55e), as the bar says and offers them: done, blocked, status <s>,
// no owner, over estimate, changed since <7d|date>, made since <7d|date>, by owner, by agent. The server reads them
// (src/lens-only.ts); here they are told from other terms, and offered in the menus of Only and Not.

/** Whether an Only term is one of the words (else it is a type). */
export const isWord = (term) => /^(done|blocked|no owner|over estimate|by owner|by agent)$|^(status|changed since|made since)\s+\S/i.test(term.trim());

/** What each word keeps, for its tooltip. */
const MEANS = {
  done: 'What is done or closed',
  blocked: 'What waits on something open, someone, or a resource that is not free',
  'no owner': 'What nobody owns',
  'over estimate': 'What has used more tokens than it was estimated to take',
  'by owner': 'What the owner last set the status of, or an agent on their word',
  'by agent': 'What an agent last set the status of, on its own judgment',
};

/** The words Only's menu offers in one click (those that take nothing after them), those already in the lens left out. */
export function offered(have) {
  return ['done', 'blocked', 'no owner', 'over estimate', 'by owner', 'by agent'].filter((word) => !have.includes(word)).map((word) => ({ word, title: MEANS[word] }));
}
