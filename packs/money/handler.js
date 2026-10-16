// The money pack's handler: run in its own sandboxed process by the kernel's pack host. Its view reads the map
// through ctx.read and writes nothing; the kernel's view tool answers it as costs.

import { costs } from './costs.js';

export default {
  'money.costs': async (input, ctx) => ({ answer: await costs(input, ctx) }),
};
