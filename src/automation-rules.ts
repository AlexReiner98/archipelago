// What makes an automation's definition complete. Kept free of runtime imports so the
// write path can check a definition before it is stored.

import type { Registry } from './packs.ts';

/** Tools an automation may call. Anything that decides or approves is left out on purpose. */
export const AUTOMATION_TOOLS = ['check_connections', 'import_audit'];

/** The days of the week, 1 for Monday to 7 for Sunday, as the time pack counts them. */
const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

/** A weekly automation's days as numbers, 1 (Monday) to 7: each given as a number or a name ("monday", "mon"). Undefined if any is neither. */
export function weekdays(given: unknown): number[] | undefined {
  const list = Array.isArray(given) ? given : [given];
  const days = list.map((d) => (typeof d === 'number' ? d : typeof d === 'string' && d.trim().length >= 3 ? DAY_NAMES.findIndex((n) => n.startsWith(d.trim().toLowerCase())) + 1 : 0));
  return list.length && days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7) ? days : undefined;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Problems with what an automation is to do, when the type written is one. */
export function checkWritten(reg: Registry, type: string, props: Record<string, unknown>): string[] {
  return reg.isA(type, 'automation') ? checkAutomation(props) : [];
}

export function checkAutomation(props: Record<string, unknown>): string[] {
  const problems: string[] = [];
  switch (props.trigger) {
    case 'every':
      if (typeof props.every_minutes !== 'number' || props.every_minutes < 1) problems.push('trigger "every" needs every_minutes of 1 or more');
      break;
    case 'daily':
      if (typeof props.at !== 'string' || !TIME.test(props.at)) problems.push('trigger "daily" needs at as "HH:MM" (24-hour, in the workspace's time zone)');
      break;
    case 'weekly':
      if (!weekdays(props.days)) problems.push('trigger "weekly" needs days: the days of the week, as names ("monday") or numbers (1 for Monday to 7)');
      if (typeof props.at !== 'string' || !TIME.test(props.at)) problems.push('trigger "weekly" needs at as "HH:MM" (24-hour, in the workspace's time zone)');
      break;
    case 'event':
      if (typeof props.on_action !== 'string' || !props.on_action) problems.push('trigger "event" needs on_action, e.g. "entity.create" or "resource.*"');
      break;
    default:
      problems.push('an automation needs trigger: every, daily, weekly or event');
  }
  const input = (props.input ?? {}) as Record<string, unknown>;
  switch (props.action) {
    case 'notify':
      break;
    case 'tool':
      if (!AUTOMATION_TOOLS.includes(props.tool as string)) problems.push(`action "tool" needs tool to be one of: ${AUTOMATION_TOOLS.join(', ')}`);
      break;
    case 'launch':
      if (typeof input.task !== 'string') problems.push('action "launch" needs input.task: the id of the entity to work on');
      if (input.mode !== undefined && input.mode !== 'plan' && input.mode !== 'acceptEdits') problems.push('input.mode must be plan or acceptEdits');
      break;
    default:
      problems.push('an automation needs action: notify, tool or launch');
  }
  return problems;
}
