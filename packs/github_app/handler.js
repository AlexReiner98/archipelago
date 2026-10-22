// The GitHub App's handler: run in its own sandboxed process by the kernel's server-pack host. It asks GitHub through
// the host it declares and the kernel for its acts; it never sees a secret and reads no map.

import { created, events, installed, manifest, refresh, start, status } from './app.js';

export default { status, start, manifest, created, installed, events, refresh };
