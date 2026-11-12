// The mail side of members: identity raises "invite issued" and "sign-in code" (packs/identity/kernel/members.ts), and
// this says how each reads and sends it. It fills identity's slot identity.invited (docs/kernel-packs.md, "Slots"),
// named in this pack's manifest and filled by the loader when the server starts (packs/loader/kernel/server-slots.ts).

import type { KernelContext } from '#pelago/kernel';
import { mailConfigured, sendMail, type Mail } from './mail.ts';

/** What identity tells the people it is about, as members raises it (MemberNotice there). */
export type MemberNotice =
  | { kind: 'invite_issued'; to: string; replyTo?: string; by: string; workspace: string; signIn: string }
  | { kind: 'sign_in_code'; to: string; codes: string[]; minutes: number; days: number };

/** The mail a member notice is. */
export function memberMail(n: MemberNotice): Mail {
  if (n.kind === 'sign_in_code')
    return {
      to: n.to,
      subject: 'Your Archipelago sign-in code',
      text: [
        'Hello,',
        `Here is the code you asked for to sign in to Archipelago. Type it on the page where you asked. It works once, for the next ${n.minutes} minutes, and keeps that browser signed in for ${n.days} days.`,
        n.codes.join('\n'),
        'If you did not ask to sign in, you can ignore this email: nobody can sign in without the code.',
        '- Archipelago',
      ].join('\n\n'),
    };
  const { to, replyTo, by, workspace } = n;
  return {
    to,
    ...(replyTo && { replyTo }),
    subject: `${by} invited you to ${workspace} on Archipelago`,
    text: [
      'Hello,',
      `${by} has invited you to ${workspace} on Archipelago, where its people and their AI agents keep track of their work together.`,
      `To accept, ${n.signIn}`,
      `You are getting this because ${by} added ${to} to ${workspace}. If you were not expecting it, you can ignore this email.${replyTo ? ` Reply to it to reach ${by}.` : ''}`,
      '- Archipelago',
    ].join('\n\n'),
  };
}

/** The filling of identity.invited: whether a notice reaches anyone (a mail goes out, or is written to the log), and sending it. */
export const invited = (_ctx: KernelContext) => ({ sends: mailConfigured, send: (n: MemberNotice) => sendMail(memberMail(n)) });
