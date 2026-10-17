// The software pack's handler: run in its own sandboxed process by the kernel's pack host. Its views read the map
// through ctx.read and write nothing; the kernel's view tool answers them by their short names (handoff, repo_work,
// recheck, agent_usage, proof, changelog). Its one action, test_report, answers with ops the kernel writes.

import { handoff } from './handoff.js';
import { changelog, proof } from './proof.js';
import { agentUsage, recheck } from './recheck.js';
import { repoWork } from './repo.js';
import { testReport } from './report.js';

const view = (fn) => async (input, ctx) => ({ answer: await fn(input, ctx) });

export default {
  'software.handoff': view(handoff),
  'software.repo_work': view(repoWork),
  'software.recheck': view(recheck),
  'software.agent_usage': view(agentUsage),
  'software.proof': view(proof),
  'software.changelog': view(changelog),
  'software.test_report': testReport,
};
