// What makes an automation's definition complete. Kept free of runtime imports so the
// write path can check a definition before it is stored.

import type { Registry } from './packs.ts';

/** Tools an automation may call. Anything that decides or approves is left out on purpose. */
export const AUTOMATION_TOOLS = ['check_connections', 'import_audit'];

/** Problems with what an automation is to do, when the type written is one. */
export function checkWritten(reg: Registry, type: string, props: Record<string, unknown>): string[] {
  return reg.isA(type, 'sys.automation') ? checkAutomation(props) : [];
}

export function checkAutomation(props: Record<string, unknown>): string[] {
  const problems: string[] = [];
  switch (props.trigger) {
    case 'every':
      if (typeof props.every_minutes !== 'number' || props.every_minutes < 1) problems.push('trigger "every" needs every_minutes of 1 or more');
      break;
    case 'daily':
      if (typeof props.at !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(props.at)) problems.push('trigger "daily" needs at as "HH:MM" (24-hour, local time)');
      break;
    case 'event':
      if (typeof props.on_action !== 'string' || !props.on_action) problems.push('trigger "event" needs on_action, e.g. "proposal.create" or "resource.*"');
      break;
    default:
      problems.push('an automation needs trigger: every, daily or event');
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
