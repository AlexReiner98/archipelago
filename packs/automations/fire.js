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

/** The session an automation that launches starts: its own input's task, mode and instructions, which the kernel checks it says. */
export function launchOf(item) {
  const input = item.props?.input ?? {};
  return { task: input.task, mode: input.mode ?? 'plan', ...(typeof input.instructions === 'string' && input.instructions && { instructions: input.instructions }) };
}

/**
 * The answer to an automation's occurrence: a notification for notify; for launch, the session it starts, unless the
 * one it last started is still open (`running`); nothing for any other action.
 */
export function answerDue(item, subject, running = false) {
  if (!fires(item)) return {};
  const action = item.props?.action ?? 'notify';
  if (action === 'notify') return { notify: [noticeOf(item, subject)], reason: `${item.title}: notified` };
  if (action === 'launch' && !running) return { launch: launchOf(item), reason: `${item.title}: launched` };
  return {};
}
