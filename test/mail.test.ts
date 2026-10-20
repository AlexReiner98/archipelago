import assert from 'node:assert/strict';
import { createHash, createVerify, generateKeyPairSync } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { test } from 'node:test';
import { compose, dkimSign, normalEmail, quotedPrintable, relaxedBody } from '../src/mail.ts';
import { deliver, dotStuff, relay } from '../src/smtp.ts';

test('an address is kept trimmed and in lower case, and what is not one is refused', () => {
  assert.equal(normalEmail(' Rosa@Acme.CA '), 'rosa@acme.ca');
  for (const bad of ['', 'rosa', 'rosa@acme', 'a b@c.d', '<x@y.z>', 42]) assert.equal(normalEmail(bad), undefined, String(bad));
});

test('a message is signed with DKIM so that the public key verifies it', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const { headers, body } = compose('Archipelago <signin@example.com>', { to: 'rosa@acme.ca', subject: 'Sign in to Acme – today', text: 'Hello\n\nA link' });
  assert.equal(headers.find(([n]) => n === 'Subject')![1].startsWith('=?UTF-8?B?'), true, 'a subject that is not plain ASCII is encoded');
  const [name, value] = dkimSign(headers, body, 'example.com', 'mail', privateKey);
  assert.equal(name, 'DKIM-Signature');
  const tags = Object.fromEntries(value.split(/;\s*/).map((t) => [t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1)]));
  assert.deepEqual([tags.d, tags.s, tags.c, tags.a], ['example.com', 'mail', 'relaxed/relaxed', 'rsa-sha256']);
  assert.equal(tags.bh, createHash('sha256').update(relaxedBody(body)).digest('base64'));
  // What a receiving server does: the signed headers, relaxed, then the signature header with b= empty.
  const relaxed = (n: string, v: string) => `${n.toLowerCase()}:${v.replace(/[ \t]+/g, ' ').trim()}`;
  const signed = tags.h.split(':').map((h: string) => headers.find(([n]) => n.toLowerCase() === h)!);
  const input = [...signed.map(([n, v]) => relaxed(n, v)), relaxed('DKIM-Signature', value.replace(/b=[^;]+$/, 'b='))].join('\r\n');
  assert.ok(createVerify('RSA-SHA256').update(input).verify(publicKey, tags.b, 'base64'));
});

test('relaxed body: spaces collapsed, trailing ones and empty last lines gone', () => {
  assert.equal(relaxedBody('a  b \r\nc\t\r\n\r\n\r\n'), 'a b\r\nc\r\n');
  assert.equal(relaxedBody('\r\n\r\n'), '');
});

/** A mail server that takes one message and keeps what it was told; with a password asked for, it never offers TLS. */
async function fakeServer() {
  const heard: string[] = [];
  let data = '';
  const server = createServer((socket) => {
    socket.setEncoding('utf8');
    let inData = false;
    let buffer = '';
    socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (inData) {
        const end = buffer.indexOf('\r\n.\r\n');
        if (end < 0) return;
        data = buffer.slice(0, end);
        buffer = buffer.slice(end + 5);
        inData = false;
        socket.write('250 queued\r\n');
      }
      let at;
      while (!inData && (at = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        heard.push(line);
        if (line.startsWith('EHLO')) socket.write('250-fake\r\n250 8BITMIME\r\n');
        else if (line === 'DATA') (socket.write('354 go on\r\n'), (inData = true));
        else if (line === 'QUIT') socket.end('221 bye\r\n');
        else if (line.startsWith('RCPT') && line.includes('nobody')) socket.write('550 no such person\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { port: (server.address() as AddressInfo).port, heard, data: () => data, close: () => server.close() };
}

test('a message is handed over in order, with a line that begins with a dot kept whole', async () => {
  const fake = await fakeServer();
  try {
    await deliver({ host: '127.0.0.1', port: fake.port, tls: false, requireTls: false }, { from: 'signin@example.com', to: 'rosa@acme.ca', data: 'Subject: x\r\n\r\n.hidden\r\nend' });
    assert.deepEqual(fake.heard.map((l) => l.split(/[ :]/)[0]), ['EHLO', 'MAIL', 'RCPT', 'DATA', 'QUIT']);
    assert.equal(fake.data(), 'Subject: x\r\n\r\n..hidden\r\nend', 'dot-stuffed on the wire');
    await assert.rejects(deliver({ host: '127.0.0.1', port: fake.port, tls: false, requireTls: false }, { from: 'a@b.c', to: 'nobody@acme.ca', data: 'x' }), /refused RCPT TO:<nobody@acme.ca>: 550 no such person/);
    // A relay given a password is never sent it in the clear.
    await assert.rejects(deliver({ ...relay(`smtp://user:secret@127.0.0.1:${fake.port}`) }, { from: 'a@b.c', to: 'rosa@acme.ca', data: 'x' }), /does not offer TLS/);
    assert.ok(!fake.heard.some((l) => l.startsWith('AUTH')));
  } finally {
    fake.close();
  }
  assert.equal(dotStuff('.a\r\n.b'), '..a\r\n..b');
});

/** Quoted-printable read back, as a mail program does. */
const unQP = (s: string) => Buffer.from(s.replace(/=\r\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), 'latin1').toString('utf8');

test('the body is quoted-printable: plain text stays readable, nothing else is lost, no line is over 76', () => {
  const text = `Hello Renée,\n\nOpen this link: https://app.example.com/#/join/inv_acme_${'a'.repeat(40)} and a = sign, trailing space \nend\t`;
  const qp = quotedPrintable(text);
  assert.ok(qp.split('\r\n').every((l) => l.length <= 76), qp);
  assert.match(qp, /^Hello Ren=C3=A9e,\r\n\r\nOpen this link: https:\/\/app\.example\.com/);
  assert.equal(unQP(qp), text.replace(/\n/g, '\r\n'));
  for (const long of ['x'.repeat(300), 'é'.repeat(100), `${'y'.repeat(73)}éé`]) assert.equal(unQP(quotedPrintable(long)), long, long.slice(0, 10));
  const { headers, body } = compose('Archipelago <signin@example.com>', { to: 'a@b.ca', subject: 's', text: 'Hi\n', replyTo: 'alex@b.ca' });
  assert.deepEqual(
    headers.filter(([n]) => ['Content-Transfer-Encoding', 'Auto-Submitted', 'Reply-To'].includes(n)),
    [['Reply-To', 'alex@b.ca'], ['Content-Transfer-Encoding', 'quoted-printable'], ['Auto-Submitted', 'auto-generated']],
  );
  assert.equal(body, 'Hi\r\n');
});
