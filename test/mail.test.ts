import assert from 'node:assert/strict';
import { createHash, createVerify, generateKeyPairSync } from 'node:crypto';
import { createServer, type AddressInfo } from 'node:net';
import { test } from 'node:test';
import { compose, dkimSign, normalEmail, relaxedBody } from '../src/mail.ts';
import { deliver, dotStuff, relay } from '../src/smtp.ts';

test('an address is kept trimmed and in lower case, and what is not one is refused', () => {
  assert.equal(normalEmail(' Mani@Aaline.CA '), 'mani@aaline.ca');
  for (const bad of ['', 'mani', 'mani@aaline', 'a b@c.d', '<x@y.z>', 42]) assert.equal(normalEmail(bad), undefined, String(bad));
});

test('a message is signed with DKIM so that the public key verifies it', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const { headers, body } = compose('Archipelago <signin@archipelago.tools>', { to: 'mani@aaline.ca', subject: 'Sign in to Aaline – today', text: 'Hello\n\nA link' });
  assert.equal(headers.find(([n]) => n === 'Subject')![1].startsWith('=?UTF-8?B?'), true, 'a subject that is not plain ASCII is encoded');
  const [name, value] = dkimSign(headers, body, 'archipelago.tools', 'mail', privateKey);
  assert.equal(name, 'DKIM-Signature');
  const tags = Object.fromEntries(value.split(/;\s*/).map((t) => [t.slice(0, t.indexOf('=')), t.slice(t.indexOf('=') + 1)]));
  assert.deepEqual([tags.d, tags.s, tags.c, tags.a], ['archipelago.tools', 'mail', 'relaxed/relaxed', 'rsa-sha256']);
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
    await deliver({ host: '127.0.0.1', port: fake.port, tls: false, requireTls: false }, { from: 'signin@archipelago.tools', to: 'mani@aaline.ca', data: 'Subject: x\r\n\r\n.hidden\r\nend' });
    assert.deepEqual(fake.heard.map((l) => l.split(/[ :]/)[0]), ['EHLO', 'MAIL', 'RCPT', 'DATA', 'QUIT']);
    assert.equal(fake.data(), 'Subject: x\r\n\r\n..hidden\r\nend', 'dot-stuffed on the wire');
    await assert.rejects(deliver({ host: '127.0.0.1', port: fake.port, tls: false, requireTls: false }, { from: 'a@b.c', to: 'nobody@aaline.ca', data: 'x' }), /refused RCPT TO:<nobody@aaline.ca>: 550 no such person/);
    // A relay given a password is never sent it in the clear.
    await assert.rejects(deliver({ ...relay(`smtp://user:secret@127.0.0.1:${fake.port}`) }, { from: 'a@b.c', to: 'mani@aaline.ca', data: 'x' }), /does not offer TLS/);
    assert.ok(!fake.heard.some((l) => l.startsWith('AUTH')));
  } finally {
    fake.close();
  }
  assert.equal(dotStuff('.a\r\n.b'), '..a\r\n..b');
});
