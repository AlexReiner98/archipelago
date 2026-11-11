// Each firing is a kept fact (decision under e_zqap4dhg, the owner, 11 Nov 2026): what an automation did when it came
// due, recorded as an automation.fired event naming the occurrence it answered (at), the item.due event it heard
// (due_seq), the automation as it then stood (version: its last position in the fact stream) and what it made. The
// kernel makes the notification after the handler answers, so the fact names it by its ref ({notice}) and the kernel
// fills in its id, or records `otherwise` when it could not be made. Kept forever by the pack's rule automation_fired.

export const FIRED = 'automation.fired';
/** The ref a firing's notification is named by in its fact. */
export const NOTICE = 'notice';
/** The ref the session a firing launched is named by in its fact: the kernel fills in its run (src/packhost.ts). */
export const RUN = 'run';
const LONGEST = 200;

const short = (text) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > LONGEST ? `${s.slice(0, LONGEST - 1)}…` : s;
};

/** What every firing fact of this occurrence says, whatever came of it. */
const occurrence = (event) => ({
  at: event?.detail?.at ?? null,
  due_seq: Number.isInteger(event?.seq) ? event.seq : null,
  version: Number.isInteger(event?.detail?.version) ? event.detail.version : null,
});

/**
 * An answer to an occurrence with the fact of its firing beside it: the notification it makes named by its ref, so
 * the fact's `made` lists its id, or, when it could not be made, the fact says it failed and why. An answer that
 * does nothing (a paused automation, an action not done here) fired nothing and records nothing.
 */
export function withFiring(item, event, answer) {
  if (answer?.launch) {
    // The kernel starts the session after the handler answers, so the fact names its run as {run}.
    const fact = {
      action: FIRED,
      target: item.id,
      reason: `${item.title}: launched`,
      detail: { ...occurrence(event), ok: true, result: 'launched', made: [`{${RUN}}`] },
      otherwise: { reason: `${item.title}: failed`, detail: { ok: false, result: 'session not started: {error}' } },
    };
    return { ...answer, log: [...(answer.log ?? []), fact] };
  }
  const notices = answer?.notify ?? [];
  if (!notices.length) return answer;
  const notify = notices.map((n, i) => ({ ...n, ref: i ? `${NOTICE}${i}` : NOTICE }));
  const fact = {
    action: FIRED,
    target: item.id,
    reason: `${item.title}: notified`,
    detail: { ...occurrence(event), ok: true, result: 'notified', made: notify.map((n) => `{${n.ref}}`) },
    otherwise: { reason: `${item.title}: failed`, detail: { ok: false, result: 'notification not made: {error}' } },
  };
  return { ...answer, notify, log: [...(answer.log ?? []), fact] };
}

/** The fact of a firing that failed before it answered: nothing made, and why. */
export function failedFiring(item, event, err) {
  const why = short(err?.message ?? err) || 'failed';
  return {
    reason: `${item.title}: failed`,
    log: [{ action: FIRED, target: item.id, reason: `${item.title}: failed`, detail: { ...occurrence(event), ok: false, result: why, made: [] } }],
  };
}
