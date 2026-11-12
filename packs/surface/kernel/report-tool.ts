// The report verb's health action, which the kernel answers (KERNEL_VERBS): a running system
// reports what it measured. The monitoring pack (packs/monitoring/kernel/report.ts, act.report.reading) reads the parts it is about and
// says the change; it is applied here through the one write path, as the reporter, a reading (measured), at once.

import { z } from 'zod';
import { callAs } from '../../loader/kernel/kernel-context.ts';
import type { Op } from '../../write/kernel/pelago-types.ts';
import type { Tool } from './tools.ts';

/** What the monitoring pack answers: what was heard and matched, and the change a reading makes. */
type Health = Record<string, unknown> & { ops?: Op[]; reason?: string };

const loose = z.looseObject({}).nullable().optional();

/** The report tool's input: Kuma's webhook body as it is, or a deploy's reading. */
const REPORT_INPUT = {
  heartbeat: loose.describe('A monitor’s check, as Uptime Kuma’s webhook sends it: status 0 down, 1 up, 2 pending, 3 maintenance; msg what it saw.'),
  monitor: loose.describe('Kuma’s monitor: name, url, hostname, port, type, docker_container.'),
  msg: z.string().optional(),
  live: z.object({ at: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{7,40}$/) }).optional().describe('A deploy: the part watched at this address is live at this commit.'),
  idle: z.array(z.string().min(1)).optional().describe('A deploy: the parts watched at these addresses were stopped on purpose.'),
  said: z.string().optional().describe('What the system said about it, in a line.'),
};

export const REPORT_TOOLS: Record<string, Tool> = {
  health: {
    description:
      'A running system reports what it measured, and the parts of the map that stand for it follow, at once: the token may be one that can only report. ' +
      'Uptime Kuma’s webhook notification posts its body here as it is (POST /agent/report, the token in an Authorization: Bearer header): the item whose watched address (a component’s url) is the monitor’s address, else whose title is its name, goes down when the check fails and up when it answers again; one still being built (planned, wiring) or stopped on purpose (standby) is left alone. ' +
      'A deploy sends live (the address of the part now live, and its commit) and idle (the addresses of the parts it stopped). Parts are found by their address, never by an id; the change set’s reason is what was reported.',
    report: true,
    input: REPORT_INPUT,
    run: async (l, actor, input) => {
      // The monitoring pack reads what the report is about and says the change; it is applied here, at once, as the actor that reported it.
      const { ops, reason, ...answer } = await callAs<Health>(l, 'act.report.reading', { given: input, by: actor.name });
      if (ops?.length) await l.change(actor, { ops, reason: reason!, authority: { of: 'agent', basis: `Reported by ${actor.name}` } }, true);
      return answer;
    },
  },
};

/** Names a tool had before it was folded into another: Kuma's webhook still posts to health_report until it is moved. The report verb with no action
 * is health too (src/surface.ts), so POST /agent/report goes on answering as it did. */
export const FORMER_NAMES: Record<string, string> = { health_report: 'health' };
