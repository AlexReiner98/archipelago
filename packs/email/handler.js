// The email channel: told by the kernel that a notification was made, it reads the email channels of the person it is
// for (items of email.channel, part of their person item) and, when one is on, answers one mail about it. The kernel
// sends that to the address the person signs in with (src/notify-mail.ts): the pack never names an address.

import { mailFor } from './channel.js';

const FIELDS = ['on', 'least', 'quiet_from', 'quiet_to', 'zone'];

export default {
  'notification.made': async ({ event }, ctx) => {
    const person = event?.detail?.for;
    if (typeof person !== 'string' || !person) return {};
    const channels = await ctx.read({ related: person, relation: 'part_of', direction: 'in', types: ['email.channel'], fields: FIELDS });
    const mail = mailFor(event, channels, ctx.now, ctx.zone);
    return mail ? { mail: [mail], reason: 'Mailed a notification' } : {};
  },
};
