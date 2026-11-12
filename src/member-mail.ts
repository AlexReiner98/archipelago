// The mail side of members: members raises "invite issued" and "sign-in code" (src/members.ts), and this says how each
// reads and sends it. Loaded with the server (src/first-start.ts), so the server that signs people in also mails them.
import { mailConfigured, sendMail, type Mail } from './mail.ts';
import { onMemberNotice, type MemberNotice } from './members.ts';

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

onMemberNotice({ sends: mailConfigured, send: (n) => sendMail(memberMail(n)) });
