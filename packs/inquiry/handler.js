// The inquiry pack's handler: run in its own sandboxed process by the kernel's pack host. Its view reads the map
// through ctx.read and writes nothing.

import { undermined } from './undermined.js';

export default {
  'inquiry.undermined': async (input, ctx) => ({ answer: await undermined(ctx) }),
};
