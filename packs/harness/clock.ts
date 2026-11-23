/**
 * Times as the Context interface writes them, each formatted once: a
 * run's start (`day`) and an event's time (`time`). Formatting a date is
 * slow (toLocaleString builds its formatter on every call), and the bar
 * writes every run's start each time an event comes, so the formatters
 * are made once and each answer is kept by its input.
 */

const DAY = new Intl.DateTimeFormat([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const TIME = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
/** How many answers each keeps before it starts again: runs and events are bounded reads, so this is never reached in a page's life. */
const KEEP = 4000;

function kept(f: Intl.DateTimeFormat) {
  const seen = new Map<string, string>();
  return (t?: string): string => {
    if (!t) return "";
    let s = seen.get(t);
    if (s === undefined) {
      if (seen.size >= KEEP) seen.clear();
      const d = new Date(t);
      s = Number.isNaN(d.getTime()) ? "" : f.format(d);
      seen.set(t, s);
    }
    return s;
  };
}

/** A run's start: month, day, hour and minute. */
export const day = kept(DAY);
/** An event's time of day, to the second. */
export const time = kept(TIME);
