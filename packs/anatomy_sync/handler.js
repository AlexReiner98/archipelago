// The anatomy sync's handler: run in its own sandboxed process by the kernel's pack host. GitHub's push webhook moves
// the Pack anatomy island to the pushed commit through a chain of requests to GitHub, each answered by a later entry
// (push.ts). It never calls out itself: the kernel makes each request, adding the token it keeps.

import { compared, fetched, listed, push } from './push.ts';

export default {
  'anatomy_sync.push': push,
  'anatomy_sync.compared': compared,
  'anatomy_sync.listed': listed,
  'anatomy_sync.fetched': fetched,
};
