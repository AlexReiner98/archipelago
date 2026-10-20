// Sending one message over SMTP, with nothing but node's own sockets: to a relay named by a URL
// (smtp://user:pass@host:587 upgrades with STARTTLS, smtps://…:465 is TLS from the start), or, with no relay, straight
// to the mail servers the recipient's domain names (its MX records, port 25, TLS when they offer it). Sending straight
// keeps mail on this server: nothing passes through a mail service in another country.

import { resolveMx } from 'node:dns/promises';
import { connect as plain, type Socket } from 'node:net';
import { hostname } from 'node:os';
import { connect as secure, type TLSSocket } from 'node:tls';

export interface Envelope {
  from: string;
  to: string;
  /** The whole message, headers and body, lines ended with CRLF. */
  data: string;
}

/** Where a message is handed over: a relay, or the recipient's own servers when there is none. */
export interface Route {
  host: string;
  port: number;
  /** TLS from the first byte (smtps), not upgraded with STARTTLS. */
  tls: boolean;
  user?: string;
  pass?: string;
  /** Refuse to send in the clear: always true for a relay that is given a password. */
  requireTls: boolean;
}

export function relay(url: string): Route {
  const u = new URL(url);
  if (u.protocol !== 'smtp:' && u.protocol !== 'smtps:') throw new Error(`A relay is smtp:// or smtps://, not ${u.protocol}`);
  const tls = u.protocol === 'smtps:';
  const user = u.username ? decodeURIComponent(u.username) : undefined;
  return { host: u.hostname, port: Number(u.port || (tls ? 465 : 587)), tls, user, pass: u.password ? decodeURIComponent(u.password) : undefined, requireTls: Boolean(user) };
}

/** The recipient's servers, most preferred first; a domain with no MX record takes mail at its own address. */
export async function mxRoutes(address: string): Promise<Route[]> {
  const domain = address.split('@').pop()!.toLowerCase();
  const records = await resolveMx(domain).catch(() => []);
  const hosts = records.length ? records.sort((a, b) => a.priority - b.priority).map((r) => r.exchange) : [domain];
  return hosts.map((host) => ({ host, port: 25, tls: false, requireTls: false }));
}

const TIMEOUT_MS = 30_000;

/** One conversation with a server: each reply read whole (its last line has a space after the code). */
class Conversation {
  private buffer = '';
  private waiting: ((line: string) => void) | undefined;
  private failed: Error | undefined;
  socket: Socket | TLSSocket;
  constructor(socket: Socket | TLSSocket) {
    this.socket = socket;
    this.listen(socket);
  }
  listen(socket: Socket | TLSSocket) {
    // Upgraded to TLS, the plain socket's bytes are the TLS socket's to read: nothing here listens to them any more.
    if (this.socket !== socket) this.socket.removeAllListeners('data').setTimeout(0);
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error('The mail server stopped answering.')));
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      this.drain();
    });
    socket.on('error', (err) => {
      this.failed = err;
      this.drain();
    });
    socket.on('close', () => {
      this.failed ??= new Error('The mail server closed the connection.');
      this.drain();
    });
  }
  private drain() {
    if (!this.waiting) return;
    const lines = this.buffer.split('\r\n');
    const end = lines.findIndex((l) => /^\d{3} /.test(l) || /^\d{3}$/.test(l));
    if (end >= 0) {
      const reply = lines.slice(0, end + 1).join('\n');
      this.buffer = lines.slice(end + 1).join('\r\n');
      const done = this.waiting;
      this.waiting = undefined;
      return done(reply);
    }
    if (this.failed) {
      const done = this.waiting;
      this.waiting = undefined;
      done(`000 ${this.failed.message}`);
    }
  }
  reply(): Promise<string> {
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.drain();
    });
  }
  /** Send a line (or nothing, to read the greeting) and require the reply's code to begin as expected. */
  async expect(line: string | undefined, code: string, shown = line): Promise<string> {
    if (line !== undefined) this.socket.write(`${line}\r\n`);
    const reply = await this.reply();
    if (!reply.startsWith(code)) throw new Error(`The mail server refused ${shown ?? 'the connection'}: ${reply.split('\n').at(-1)}`);
    return reply;
  }
}

const open = (route: Route): Promise<Socket | TLSSocket> =>
  new Promise((resolve, reject) => {
    const socket = route.tls ? secure({ host: route.host, port: route.port, servername: route.host }, () => resolve(socket)) : plain({ host: route.host, port: route.port }, () => resolve(socket));
    socket.once('error', reject);
    socket.setTimeout(TIMEOUT_MS, () => socket.destroy(new Error(`No answer from ${route.host}:${route.port}.`)));
  });

/** A line that is only a dot ends the message, so a line of the body that begins with one gets another. */
export const dotStuff = (data: string) => data.replace(/(^|\r\n)\./g, '$1..');

/** Hand one message to one server. Throws, saying what the server said, when it is not taken. */
export async function deliver(route: Route, envelope: Envelope, options: { rejectUnauthorized?: boolean } = {}): Promise<void> {
  const talk = new Conversation(await open(route));
  const me = hostname();
  try {
    await talk.expect(undefined, '220');
    let hello = await talk.expect(`EHLO ${me}`, '250');
    if (!route.tls && /STARTTLS/i.test(hello)) {
      await talk.expect('STARTTLS', '220');
      const upgraded = await new Promise<TLSSocket>((resolve, reject) => {
        const s = secure({ socket: talk.socket, servername: route.host, rejectUnauthorized: options.rejectUnauthorized ?? route.requireTls }, () => resolve(s));
        s.once('error', reject);
      });
      talk.listen(upgraded);
      hello = await talk.expect(`EHLO ${me}`, '250');
    } else if (!route.tls && route.requireTls) {
      throw new Error(`${route.host} does not offer TLS, and a password is not sent in the clear.`);
    }
    if (route.user) await talk.expect(`AUTH PLAIN ${Buffer.from(`\0${route.user}\0${route.pass ?? ''}`).toString('base64')}`, '235', 'the sign-in');
    await talk.expect(`MAIL FROM:<${envelope.from}>`, '250');
    await talk.expect(`RCPT TO:<${envelope.to}>`, '25');
    await talk.expect('DATA', '354');
    await talk.expect(`${dotStuff(envelope.data)}\r\n.`, '250', 'the message');
    // Taken by now: a server that hangs up instead of saying goodbye changes nothing.
    await talk.expect('QUIT', '221').catch(() => undefined);
  } finally {
    talk.socket.end();
  }
}
