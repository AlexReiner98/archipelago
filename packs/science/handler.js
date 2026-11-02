// The science pack's handler: run in its own sandboxed process by the kernel's pack host. Its views read the map
// through ctx.read and write nothing.

import { record, recordRows } from './record.js';
import { undermined } from './undermined.js';

export default {
  'science.undermined': async (input, ctx) => ({ answer: await undermined(ctx) }),
  'science.record': async (input, ctx) => ({ answer: await record(input, ctx) }),
  'science.record_rows': async (input, ctx) => ({ answer: await recordRows(input, ctx) }),
};
