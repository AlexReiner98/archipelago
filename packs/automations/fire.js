// What an automation does when it comes due, decided without the map: the automation, what it is about and the due
// fact in, the answer out. The handler reads; the kernel applies what this answers (a notification made as the pack).

/** Whether an item is an automation that may fire now: of the automation type or a flavour of it, and enabled. */
export const fires = (item) => Boolean(item && (item.is ?? [item.type]).includes('automation') && item.status === 'enabled');

/** The notification an automation that tells a person makes when it comes due: about its subject, else about itself. */
export function noticeOf(item, subject) {
  const p = item.props ?? {};
  const title = (typeof p.message === 'string' && p.message.trim()) || item.title;
  const level = ['info', 'warning', 'urgent'].includes(p.level) ? p.level : 'info';
  return { title, level, about: subject ?? item.id };
}

/** The answer to an automation's occurrence: a notification for notify; nothing, yet, for any other action. */
export function answerDue(item, subject) {
  if (!fires(item)) return {};
  const action = item.props?.action ?? 'notify';
  if (action !== 'notify') return {};
  return { notify: [noticeOf(item, subject)], reason: `${item.title}: notified` };
}
