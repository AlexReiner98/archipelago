# Sign-in mail: the runbook

Archipelago mails invitations and sign-in links itself (`src/mail.ts`, `src/smtp.ts`), signed with DKIM. The app's
server is an OVH **Public Cloud** instance, and Public Cloud blocks outgoing mail ports (25, 465, 587), so its mail
goes through a relay: a small OVH **VPS** in Beauharnois, where port 25 is open, joined to the app's server by
WireGuard. The relay takes mail only from the app's server, over the tunnel, and delivers it to each recipient's own
mail server. Nothing passes through a mail service, and everything stays in Canada.

```
app (container) ──smtp, port 25, inside WireGuard──▶ relay 10.66.0.3 (Postfix) ──smtp, port 25──▶ recipient's server
hub 10.66.0.1, 148.113.137.251                         mail.archipelago.tools
```

Done once, on 20 Oct 2026. Each step says how to check it, so a step can be redone on its own.

## 1. DNS, at OVH (Web Cloud → Domain names → archipelago.tools → DNS zone)

| Record | Name | Value |
|---|---|---|
| A | `mail` | the relay's IPv4 |
| TXT (SPF; one record only) | *(root)* | `v=spf1 ip4:<hub IPv4> ip4:<relay IPv4> -all` |
| TXT (DKIM) | `mail._domainkey` | `v=DKIM1; k=rsa; p=<public key, step 2>` |
| TXT (DMARC; one record only) | `_dmarc` | `v=DMARC1; p=quarantine; adkim=s; aspf=s` |

Reverse DNS (Bare Metal Cloud → Network → IP, the address's ⋯ → Modify the reverse DNS): the relay's IPv4 →
`mail.archipelago.tools`, the hub's → `app.archipelago.tools`. Two DMARC or two SPF records cancel each other: delete
any default one OVH made.

Check: `nslookup -type=TXT archipelago.tools ns10.ovh.ca` (and the same for `_dmarc.` and `mail._domainkey.`), and
`nslookup <relay IPv4>`.

## 2. The DKIM key, on the hub

```bash
mkdir -p -m 700 ~/mail-keys && (umask 077; openssl genrsa -out ~/mail-keys/dkim-mail.pem 2048)
echo "v=DKIM1; k=rsa; p=$(openssl rsa -in ~/mail-keys/dkim-mail.pem -pubout -outform der | base64 -w0)"
```

The second line is the DKIM record's value. The private key never leaves the hub.

## 3. The relay

Order an OVH **VPS** (not Public Cloud), the smallest, in Beauharnois, Ubuntu 24.04. It arrives in a few minutes to
an hour, with a password for `ubuntu` in OVH's email and no SSH key, and the password must be changed at the first
login, which needs a terminal of its own (a piped command is refused with "no TTY"). So, by hand, in a terminal:

```bash
ssh ubuntu@<relay IPv4>
```

(OVH's password, then a new one twice: nothing shows as you type; it then closes the connection), and then

```bash
cat ~/.ssh/archipelago_vps.pub | ssh ubuntu@<relay IPv4> "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
```

From then on the key does it all, from this repository's folder (`setup.sh` also turns password logins off):

```bash
ssh -i ~/.ssh/archipelago_vps ubuntu@10.66.0.1 'sudo cat /etc/wireguard/server.key | wg pubkey'
ssh -i ~/.ssh/archipelago_vps ubuntu@<relay IPv4> 'sudo bash -s -- <hub key from the line above>' < deploy/relay/setup.sh
```

`setup.sh` installs Postfix and WireGuard, closes the firewall to all but SSH and mail from the hub, and ends with
two checks and the relay's public key. **If it says port 25 out is BLOCKED, stop:** this host cannot be the relay.

On the hub, take the relay on as a peer, then check both ends:

```bash
ssh -i ~/.ssh/archipelago_vps ubuntu@10.66.0.1 'sudo bash -s -- add <relay key>' < deploy/relay/hub.sh
ssh -i ~/.ssh/archipelago_vps ubuntu@10.66.0.1 'bash -s -- check' < deploy/relay/hub.sh
```

`check` should say the tunnel is up and the relay answers on port 25 from the host and from the app's container.
Once `ssh ubuntu@10.66.0.3` works, close SSH from the internet: `ssh ubuntu@10.66.0.3 'sudo bash setup.sh lock-ssh'`.

## 4. The app's settings, in `deploy/.env` on the hub

```bash
cd ~/archipelago/deploy && cp -p .env .env.before-mail && { grep -v '^PELAGO_MAIL_FROM=\|^PELAGO_DKIM_SELECTOR=\|^PELAGO_DKIM_KEY=\|^PELAGO_SMTP_URL=' .env; echo 'PELAGO_MAIL_FROM=Archipelago <signin@archipelago.tools>'; echo 'PELAGO_DKIM_SELECTOR=mail'; printf 'PELAGO_DKIM_KEY=%s\n' "$(awk 'NF{printf "%s\\n", $0}' ~/mail-keys/dkim-mail.pem)"; echo 'PELAGO_SMTP_URL=smtp://10.66.0.3:25'; } > .env.new && chmod --reference=.env .env.new && mv .env.new .env
```

The key goes in as one line and is never printed. The next deploy picks the settings up; to pick them up without
one, recreate the live colour's container (`deploy.sh` says which is live).

## 5. Try it

Add yourself as a member of a workspace (Workspace → Members) and open the invitation. In Gmail, ⋮ → Show original
should say **SPF: PASS, DKIM: PASS, DMARC: PASS**. If the invitation says it was not sent, the reason is in its
message; on the relay, `sudo journalctl -u postfix -n 50` shows each delivery and why one failed.
