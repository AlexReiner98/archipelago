// The anatomy sync's handler: run in its own sandboxed process by the kernel's pack host. GitHub's push webhook moves
// the Pack anatomy island to the pushed commit through a chain of requests to GitHub, each answered by a later entry
// (push.ts); as the server starts and every hour, a catch-up asks where main stands and runs the same chain when the
// island is behind (catch-up.ts). It never calls out itself: the kernel makes each request, adding the token it keeps.

import { catchUp, head } from './catch-up.ts';
import { compared, fetched, listed, push } from './push.ts';

export default {
  'anatomy_sync.push': push,
  'anatomy_sync.compared': compared,
  'anatomy_sync.listed': listed,
  'anatomy_sync.fetched': fetched,
  'anatomy_sync.catch_up': catchUp,
  'anatomy_sync.head': head,
};
