// The mail this server sends: an invitation and a sign-in link, plain text. It goes out from this server itself
// (src/smtp.ts), signed with DKIM so the recipient's server can tell it really comes from our domain.
//
// Settings, from the environment:
//   PELAGO_MAIL_FROM      who it is from, e.g. "Archipelago <signin@archipelago.tools>". Without it nothing is sent:
//                         each message is written to the server's log instead, which is what a laptop wants.
//   PELAGO_SMTP_URL       a relay to hand mail to (smtp://user:pass@host:587); without it, mail goes straight to the
//                         recipient's servers.
//   PELAGO_DKIM_SELECTOR  with PELAGO_DKIM_KEY (a PEM private key, or the path of a file holding one): the signature.
//                         The public half is published at <selector>._domainkey.<domain> as a TXT record.

import { createHash, createSign, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { env } from './env.ts';
import { deliver, mxRoutes, relay, type Route } from './smtp.ts';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

type Mailer = (mail: Mail) => Promise<void>;
let mailer: Mailer | undefined;
/** Put something else in the place of sending, for tests. Undefined puts sending back. */
export function setMailer(m: Mailer | undefined) {
  mailer = m;
}

/** An address on its own, from "Name <address>" or a bare address. */
export const addressOf = (from: string) => /<([^>]+)>/.exec(from)?.[1] ?? from.trim();

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
/** An email address as it is kept and compared: trimmed and in lower case. Undefined when it is not one. */
export function normalEmail(email: unknown): string | undefined {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return EMAIL.test(e) && e.length <= 254 ? e : undefined;
}

/** Whether this server sends mail, or only writes it to its log. */
export const mailConfigured = () => Boolean(env('MAIL_FROM'));

/** A header's value in words a mail program reads whatever the letters: plain when it is plain ASCII. */
const word = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);

/** The message itself: headers and a base64 body, lines ended with CRLF. */
export function compose(from: string, mail: Mail, now = new Date()): { headers: [string, string][]; body: string } {
  const domain = addressOf(from).split('@')[1];
  const name = /^(.*?)\s*</.exec(from)?.[1]?.replace(/^"|"$/g, '');
  const body = (Buffer.from(mail.text.replace(/\r?\n/g, '\r\n')).toString('base64').match(/.{1,76}/g) ?? []).join('\r\n') + '\r\n';
  return {
    headers: [
      ['From', name ? `${word(name)} <${addressOf(from)}>` : addressOf(from)],
      ['To', mail.to],
      ['Subject', word(mail.subject)],
      ['Date', now.toUTCString().replace('GMT', '+0000')],
      ['Message-ID', `<${randomBytes(12).toString('hex')}@${domain}>`],
      ['MIME-Version', '1.0'],
      ['Content-Type', 'text/plain; charset=utf-8'],
      ['Content-Transfer-Encoding', 'base64'],
    ],
    body,
  };
}

// DKIM, relaxed/relaxed (RFC 6376 section 3.4).
const relaxedHeader = (name: string, value: string) => `${name.toLowerCase()}:${value.replace(/\r\n(?=[ \t])/g, '').replace(/[ \t]+/g, ' ').trim()}`;
export function relaxedBody(body: string): string {
  const lines = body.split('\r\n').map((l) => l.replace(/[ \t]+/g, ' ').replace(/ $/, ''));
  while (lines.length && lines.at(-1) === '') lines.pop();
  return lines.length ? `${lines.join('\r\n')}\r\n` : '';
}

/** The DKIM-Signature header for a message, signed with the key for `domain` under `selector`. */
export function dkimSign(headers: [string, string][], body: string, domain: string, selector: string, key: string, now = new Date()): [string, string] {
  const bh = createHash('sha256').update(relaxedBody(body)).digest('base64');
  const signed = headers.filter(([n]) => ['from', 'to', 'subject', 'date', 'message-id', 'mime-version', 'content-type'].includes(n.toLowerCase()));
  const value = `v=1; a=rsa-sha256; c=relaxed/relaxed; d=${domain}; s=${selector}; t=${Math.floor(now.getTime() / 1000)}; h=${signed.map(([n]) => n.toLowerCase()).join(':')}; bh=${bh}; b=`;
  const input = [...signed.map(([n, v]) => relaxedHeader(n, v)), relaxedHeader('DKIM-Signature', value)].join('\r\n');
  return ['DKIM-Signature', value + createSign('RSA-SHA256').update(input).sign(key, 'base64')];
}

const dkimKey = () => {
  const given = env('DKIM_KEY');
  if (!given) return undefined;
  return given.includes('-----BEGIN') ? given.replace(/\\n/g, '\n') : existsSync(given) ? readFileSync(given, 'utf8') : undefined;
};

/** Send one message as configured. Throws when no server took it. */
export async function sendMail(mail: Mail): Promise<void> {
  if (mailer) return mailer(mail);
  const from = env('MAIL_FROM');
  if (!from) {
    console.log(`mail (not sent: PELAGO_MAIL_FROM is not set) to ${mail.to}: ${mail.subject}\n${mail.text}`);
    return;
  }
  const { headers, body } = compose(from, mail);
  const key = dkimKey();
  const selector = env('DKIM_SELECTOR');
  const all = key && selector ? [dkimSign(headers, body, addressOf(from).split('@')[1], selector, key), ...headers] : headers;
  const data = `${all.map(([n, v]) => `${n}: ${v}`).join('\r\n')}\r\n\r\n${body}`;
  const smtp = env('SMTP_URL');
  const routes: Route[] = smtp ? [relay(smtp)] : await mxRoutes(mail.to);
  let last: Error | undefined;
  for (const route of routes) {
    try {
      return await deliver(route, { from: addressOf(from), to: mail.to, data });
    } catch (err) {
      last = err as Error;
    }
  }
  throw new Error(`The mail to ${mail.to} was not sent: ${last?.message ?? 'no server to send it to'}`);
}
