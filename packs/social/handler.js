// The social pack's handler: run in its own sandboxed process by the kernel's pack host. Its webhook takes a signup or
// a day's visits counted by the server that sells workspaces and adds it to the post whose tag it carries; its action
// makes a conversation a post began; its schedule writes down each month's channels once the month is over. It never
// calls out.

import { conversation } from './conversation.js';
import { count } from './count.js';
import { reading } from './reading.js';

export default {
  'social.count': count,
  'social.conversation': conversation,
  'social.reading': reading,
};
