// The GitHub pack's handler: run in its own sandboxed process by the kernel's pack host. Its webhook takes a push in
// and answers what the kernel records, tells the owner and proposes; its schedule makes items for pushed commits nobody
// accounted for. It never writes and never calls out.

import { commits } from './heard.js';
import { push } from './push.js';

export default {
  'github.push': push,
  'github.commits': commits,
};
