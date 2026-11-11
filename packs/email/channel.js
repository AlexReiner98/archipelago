// Whether a notification is mailed, and what the mail says: the person's email channel in, a mail or nothing out.
// Nothing here reads the map or sends anything: the handler reads, and the kernel sends (src/notify-mail.ts) to the
// address the person signs in with, so a channel never names where mail goes.

const LEVELS = ['info', 'warning', 'urgent'];
const rank = (level) => Math.max(0, LEVELS.indexOf(level));

/** Minutes after midnight of an HH:MM, or undefined when it is not one. */
export function minutesOf(hhmm) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hhmm ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : undefined;
}

/** Minutes after midnight of an instant, in a zone (UTC when the zone is not one). */
export function minutesIn(now, zone) {
  const at = new Date(now);
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: zone || 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at);
  }
  const part = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return part('hour') * 60 + part('minute');
}

/** Whether an instant falls in quiet hours from..to (which may run past midnight). None when either is unsaid or they are equal. */
export function isQuiet(channel, now, zone) {
  const from = minutesOf(channel.quiet_from), to = minutesOf(channel.quiet_to);
  if (from === undefined || to === undefined || from === to) return false;
  const m = minutesIn(now, channel.zone || zone);
  return from < to ? m >= from && m < to : m >= from || m < to;
}

/** The first of a person's channels that is on. */
export const channelOn = (channels) => (channels ?? []).map((c) => c.props ?? c).find((c) => c.on === true);

/**
 * The mail for a notification made, by the person's channels, or undefined when none is sent: mail is off (or there
 * is no channel), the notification is below the least level, or it is quiet hours and the notification not urgent.
 */
export function mailFor(event, channels, now, zone) {
  const channel = channelOn(channels);
  if (!channel || typeof event?.target !== 'string') return undefined;
  const d = event.detail ?? {};
  const level = LEVELS.includes(d.level) ? d.level : 'info';
  if (rank(level) < rank(channel.least ?? 'info')) return undefined;
  if (level !== 'urgent' && isQuiet(channel, now, zone)) return undefined;
  const title = String(d.title ?? '').trim() || 'A notification';
  const body = String(d.body ?? '').trim();
  return {
    notification: event.target,
    subject: level === 'info' ? title : `${level === 'urgent' ? 'Urgent' : 'Warning'}: ${title}`,
    text: body || title,
  };
}
