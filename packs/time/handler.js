// The time pack's handler: run in its own sandboxed process by the kernel's pack host. Each entry is an action or
// view the pack declares in pack.json; it reads the map through ctx.read and answers with ops, which the kernel
// writes as one change set naming the action. It never writes itself.

import { draftInvoice, log, payInvoice, timesheet, voidInvoice } from './money.js';
import { week } from './week.js';

export default {
  'time.log': log,
  'time.timesheet': timesheet,
  'time.week': async (input, ctx) => ({ answer: await week(input, ctx) }),
  'time.invoice_draft': draftInvoice,
  'time.invoice_paid': payInvoice,
  'time.invoice_void': voidInvoice,
};
