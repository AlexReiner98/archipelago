// The time pack's tools: logging time, the timesheet, the week, and invoices. Offered only while the time pack is
// loaded (src/pack-tools.ts). Kept apart from the kernel's tools until the time pack declares them as its own
// actions and views, run by its handler.

import { z } from 'zod';
import { draftInvoice, logTime, payInvoice, timesheet, voidInvoice, week } from './time.ts';
import type { Tool } from './tools.ts';

export const TIME_TOOLS: Record<string, Tool> = {
  time_log: {
    description:
      'Record time spent on a piece of work: how many hours, on which day (today unless given, in Toronto), what was done in a few words, and a note if there is more to say. ' +
      'Or a block, with start and end in place of hours: the hours are the time between, and the day is the day it began. ' +
      'planned: true sets the time aside without saying it was worked: it counts toward nothing and is not invoiced until the owner confirms it. ' +
      'work is the id of the project, task or client it was for; the client billed is the company that work, or what it sits in, involves. Search for the work first. Say what you logged back to the person, with the client.',
    input: {
      work: z.string().describe('Id of the project, task or client company the time was for.'),
      hours: z.number().optional().describe('Hours spent, e.g. 1.5. Needed unless start and end are given.'),
      start: z.string().optional().describe('When the block began, as a date-time with its offset, e.g. 2026-10-15T09:30:00-04:00.'),
      end: z.string().optional().describe('When the block ended.'),
      what: z.string().min(1).max(60).describe('What was done, in a few words: the entry’s title.'),
      note: z.string().optional().describe('More about the work, if there is more to say.'),
      date: z.string().optional().describe('The day, as 2026-10-15. Today when left out.'),
      billable: z.boolean().optional().describe('false for time that is not to be invoiced.'),
      rate: z.number().optional().describe('An hourly rate for this entry only, when it is not the client’s.'),
      planned: z.boolean().optional().describe('true for time set aside ahead, not yet worked.'),
    },
    run: async (l, actor, input) => logTime(l, actor, input),
  },
  timesheet: {
    description: 'Time logged over a span of days, by day and by client; what is logged but not yet invoiced, by client; and invoices not yet paid (invoices: outstanding, overdue with how many days, drafts, owed_total). This week (Monday to Sunday) unless from and to are given.',
    input: { from: z.string().optional().describe('The first day, as 2026-10-01.'), to: z.string().optional().describe('The last day.') },
    run: async (l, _actor, input) => timesheet(l, input),
  },
  week: {
    description:
      'A week as a calendar, Monday to Sunday (this week unless from is given): for each day, the owner’s blocks (owner: time entries, with start and end where they were logged as blocks, else hours alone) and the agents’ lanes (agents: one list per agent at work at once, each block a session, or the part of one spent on one piece of work). ' +
      'Every block has from_hour and to_hour (hours since that day’s midnight in Toronto), hours, the work and the project it counts toward; projects lists them in the order the page colours them. ' +
      'An owner block with status planned is time set aside: a day’s hours leave it out and planned counts it. to_confirm lists planned time whose end has passed, in any week, for the owner to confirm (status logged), as planned or as it happened, or drop. Only a person can confirm it: an agent that tries is refused.',
    input: { from: z.string().optional().describe('Any day in the week, or its Monday, as 2026-10-12.') },
    run: async (l, _actor, input) => week(l, input),
  },
  invoice_draft: {
    description:
      'Draft an invoice to a client company for its billable time not yet invoiced, up to a day (today unless given). The client says who bills it (billed_by), its rate, terms_days, currency and whether HST is charged (hst). ' +
      'The invoice is a document, part of the client, numbered INV-<year>-<n> for its biller; its entries are marked invoiced. It stays a draft until the owner sends it; invoice_void undoes it.',
    input: {
      client: z.string().describe('Id of the client company.'),
      from: z.string().optional().describe('Only time from this day, as 2026-10-01.'),
      to: z.string().optional().describe('Only time up to this day. Today when left out.'),
    },
    run: async (l, actor, input) => draftInvoice(l, actor, input),
  },
  invoice_paid: {
    description: 'Record a payment received on an invoice: the day (today unless given), the amount (all that is still owed unless given) and how it came (e-Transfer, EFT, cheque, card). Paid in full, the invoice closes as paid; a part-payment leaves it open with what is still owed. Record what the owner says came in.',
    input: {
      id: z.string().describe('The invoice.'),
      amount: z.number().optional().describe('What was received. All that is still owed when left out.'),
      date: z.string().optional().describe('The day it was received, as 2026-10-15. Today when left out.'),
      method: z.string().optional().describe('How it came, e.g. e-Transfer, EFT, cheque.'),
    },
    run: async (l, actor, input) => payInvoice(l, actor, input),
  },
  invoice_void: {
    description: 'Void an invoice: it is kept, marked void, and its time entries go back to being logged, to be invoiced again.',
    input: { id: z.string().describe('The invoice.'), reason: z.string().optional() },
    run: async (l, actor, input) => voidInvoice(l, actor, input),
  },
};
