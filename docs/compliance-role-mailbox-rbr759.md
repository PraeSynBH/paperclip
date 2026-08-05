# Compliance Role Mailbox — Runbook (RBR-759)

**Status:** harness built and verified; **dispatch retargeted to `ben.hamilton@aira.io` by RBR-766.**
`security@aira.io` conversion remains the permanent home but is **off the critical path**.
**Owner:** CTO
**Purpose:** one mailbox that can send an RFQ to a vendor and read the proposal that comes back, without a human forwarding anything.

> ## RBR-766 amendment (August 5, 2026) — read this first
>
> The CEO decided on RBR-398 (comment `4c573d62`) to dispatch the certification-body RFQs
> from **`ben.hamilton@aira.io`** rather than wait for a `security@` conversion. That address
> is a real Workspace user on the certified domain, so it needs **no Workspace admin** — only
> an App Password. §4 below (provisioning `security@` as a new user) is therefore **not on
> the critical path**; the only step that matters for the Aug 12 proposal deadline is
> generating an App Password for the existing `ben.hamilton@` account, i.e. §4 steps 2–5.
>
> What RBR-766 added:
> - `scripts/dispatch_rfqs_rbr766.sh` — gate-first single-command dispatch.
> - `scripts/watch_rfq_replies_rbr766.py` — inbound watch that wakes an agent on RBR-398.
> - Both RFQs finalised: zero `{{...}}` tokens, sender email and phone wording in place.
> - Evidence: `data/evidence/rbr-766-dispatch-readiness-*.json`.
>
> **Caveat on the IMAP probe.** The `Invalid credentials` response for `ben.hamilton@aira.io`
> is *indeterminate*, not proof of existence — a guaranteed-nonexistent control address
> returns exactly the same string. Existence is corroborated by the Drata roster
> (`userId 659`, `CURRENT_EMPLOYEE`), but only `selftest` with a live credential proves the
> mailbox is login-capable. The dispatch script enforces that gate and refuses to send
> without it.

---

## 1. Why this exists

RBR-398 (ISO 27001 CB outreach) stalled 23+ days on a missing sender email and phone. That
dependency recurs on every outbound vendor interaction: CB proposals, Drata, pen-test vendors,
insurers, customer security questionnaires.

The half that usually gets forgotten is **inbound**. A send-only alias does not fix the stall,
it relocates it — when A-LIGN replies, the reply lands somewhere no agent can read.

---

## 2. Findings — check-before-build

The issue asked us to check whether a role mailbox already exists. It does not, but something
adjacent does, and the distinction is the whole point of this issue.

### 2.1 `aira.io` is Google Workspace

```
$ dig +short MX aira.io
1  aspmx.l.google.com.
5  alt1.aspmx.l.google.com.   5  alt2.aspmx.l.google.com.
10 alt3.aspmx.l.google.com.   10 alt4.aspmx.l.google.com.
```

DNS is hosted at Google Cloud DNS (`ns-cloud-e{1..4}.googledomains.com`). SPF authorises
Google, Mandrill, Salesforce and Firebase. DMARC is at **`p=reject`**, aggregate and forensic
reports going to `it@aira.io`.

> `p=reject` matters: any outbound path that is not SPF/DKIM-aligned with `aira.io` will be
> **rejected outright** at the recipient. Sending vendor RFQs from a third-party relay
> (Mandrill, SendGrid, a personal address) is not a viable shortcut.

### 2.2 `security@aira.io` already exists — but as an alias/group, not a mailbox

Probing IMAP auth against `imap.gmail.com` with a deliberately wrong password produces two
distinguishable errors, and the split is stable across repeated runs:

| Address | IMAP response | What it proves |
|---|---|---|
| **`security@aira.io`** | **`Lookup failed`** | **routes, but has no IMAP mailbox — alias/group** |
| **`it@aira.io`** | **`Lookup failed`** | **routes, but has no IMAP mailbox — alias/group** |
| `ben.hamilton@aira.io` | `[AUTHENTICATIONFAILED] Invalid credentials` | **nothing — indeterminate** |
| `compliance@aira.io` | `[AUTHENTICATIONFAILED] Invalid credentials` | **nothing — indeterminate** |
| `zz-nonexistent-control-probe-9x7q@aira.io` (control) | `[AUTHENTICATIONFAILED] Invalid credentials` | **nothing — indeterminate** |

Reproduce with `python3 scripts/compliance_mailbox.py probe <addr>...` (no credential needed).

`it@aira.io` is independently confirmed as a live destination — it is the DMARC `rua`/`ruf`
target and is receiving reports today. So `Lookup failed` is not "no such address"; it is
"this address delivers somewhere, but it is not a login-capable mailbox." That is the
signature of a **Google Group or a user alias**.

**This is precisely the send-only-alias trap the issue warned about.** If we print
`security@aira.io` on the RFQ as-is, outbound may work, but A-LIGN's reply lands in a group
no agent can authenticate to, and RBR-398 stalls again on the return leg.

### 2.2.1 Correction — the probe is asymmetric, and only one half is evidence

An earlier revision of this document, and the RBR-398 relay built on it, read
`Invalid credentials` as "real user mailbox". **That reading is wrong**, and the error is
consequential enough to call out explicitly.

The control line above is the proof. `zz-nonexistent-control-probe-9x7q@aira.io` is an
address nobody has ever created, and it returns a response byte-identical to
`ben.hamilton@aira.io`. Google deliberately does not leak account non-existence on IMAP
auth, so `Invalid credentials` is returned for a real mailbox *and* for an address that does
not exist. It carries **zero** information about existence.

The probe is therefore **one-directional**:

- `Lookup failed` → **conclusive negative.** The address cannot hold credentials. Acceptance
  criterion 2 is unreachable for it without conversion to a full Workspace user.
- `Invalid credentials` → **no conclusion.** Never cite it as evidence a mailbox exists.

Only `selftest` with a real credential proves an address is usable. `cmd_probe` now labels
every `indeterminate` result in-band and always runs the control address alongside the
candidates, so the output cannot be misread the same way twice.

**Consequence for dispatch.** RBR-766 was created on the premise that
`ben.hamilton@aira.io` is "already a real, login-capable mailbox … it needs only an App
Password." That premise is unverified. It is still the most *likely* candidate — it matches
the human's name on a domain he administers — but "likely" is not the standard for an
address printed on an ISO 27001 RFQ. The existing hard gate on RBR-766 (`selftest` +
`roundtrip` must return `"ok": true` before anything is dispatched) already catches this:
if the address turns out not to exist, the gate fails closed rather than sending an RFQ with
an unreachable reply-to. The gate must not be relaxed.

> Still inference, not admin-confirmed — no Workspace admin credential exists on this host.
> Ben can settle both questions in ~30 seconds in the Admin console. The provisioning
> decision in §4 is written to be correct either way.

### 2.3 No Workspace admin credential is available to agents

`gcloud`, `gam`, `gamadv-xtd3`, `gyb` are all absent; there is no ADC and no service-account
JSON. Unauthenticated Admin SDK returns 401. Outbound port 25 is blocked from this host
(`No route to host`), so direct-to-MX delivery is not an option either.

**An agent cannot create a Workspace mailbox. That step is Ben's, and it is the only blocking step.**

---

## 3. What was built

`scripts/compliance_mailbox.py` — a zero-dependency (stdlib-only) IMAP/SMTP client.

Deliberately narrow, per the issue's scope guidance. It is not a general-purpose agent email
framework: it sends, lists, reads, and self-tests. Nothing else.

```
selftest    verify IMAP + SMTP auth without sending anything
send        send outbound, with attachments (the RFQ PDF path)
inbox       list inbound; --search scopes by subject server-side
read        fetch one message by UID, body + attachment names
roundtrip   send-to-self then retrieve it — acceptance evidence, writes JSON
```

### Credential handling (`secret_ref`, never inline `.env`)

Resolution order, per Ben's stated preference and `docs/SECRETS.md`:

1. `COMPLIANCE_MAILBOX_PASSWORD` — injected by Paperclip from a company secret via
   `secret_ref`. **This is the production path for the CISO agent.**
2. `COMPLIANCE_MAILBOX_PASSWORD_CMD` — a command that prints the secret (keychain, `pass`).
3. AWS Secrets Manager `aira/secrets` → key `COMPLIANCE_MAILBOX_PASSWORD`.

The password is never accepted as an inline `.env` literal, never printed, and never written
to the evidence file. `selftest` output reports only `"<resolved via ...>"` plus the source.
With no credential configured the script exits `2` and names all three options.

### Provider profiles

`google` (default, matches the `aira.io` Workspace), `protonbridge`, and `generic`. Every
host/port/security field is individually overridable via `COMPLIANCE_MAILBOX_*` env vars, so
switching providers never requires a code change.

---

## 3.1 The AC2 guard — the trap is now mechanically impossible

Documentation alone does not stop the send-only-alias failure; the next agent under deadline
pressure will not read §2.2.1. So `send` enforces it.

Before any outbound mail leaves, `cmd_send` performs an IMAP login as the sender. If inbound
mail for that address cannot be read, the send is **refused** and nothing is transmitted:

```
$ COMPLIANCE_MAILBOX_ADDRESS=security@aira.io python3 scripts/compliance_mailbox.py \
    send --to proposals@a-lign.com --subject "ISO 27001 RFQ" --body ...
[error] Refusing to send: cannot read inbound mail for security@aira.io.
  IMAP login failed for security@aira.io at imap.gmail.com:993: Lookup failed
A send-only address moves the stall to the reply leg — the vendor's
response would land somewhere no agent can retrieve (RBR-759 AC2).
Fix the mailbox, or pass --allow-unreadable-sender to override deliberately.
exit 1
```

This is an authoritative check, not the `probe` heuristic: a successful IMAP login *is*
readability. `--allow-unreadable-sender` exists for a deliberate send-only case, but it has
to be asked for by name.

### Tests

`scripts/test_compliance_mailbox.py` — 17 checks against in-process fake IMAP/SMTP servers.
No credentials, no network, no live mailbox required, which matters because the guard must
be testable without the mailbox that does not exist yet.

```
$ python3 scripts/test_compliance_mailbox.py
  AC2 guard    send refused · exit 1 · NO mail transmitted
  AC1          send proceeds when inbound readable · body transmitted
  Override     --allow-unreadable-sender bypasses deliberately
  AC3          missing credential exits 2, never a .env literal
  Probe        'Lookup failed' conclusive · 'Invalid credentials' indeterminate
  17/17 checks passed
```

---

## 4. Provisioning — the one step that needs Ben

Recommended: **`security@aira.io` as a full Workspace user**, not a group or alias.

A group cannot hold IMAP credentials, so it cannot satisfy acceptance criterion 2
(agent-readable inbound). If `security@` is currently a group, it needs to be converted, or
the group renamed and the address reassigned to a real user.

1. Admin console → Directory → Users → **Add new user**
   - Name: `Aira Security & Compliance`, address `security@aira.io`
   - If `security@` is already a group/alias, free the address first.
2. Sign in once as that user, then enable **2-Step Verification** (required for step 3).
3. Generate an **App Password** (Mail). This is the credential the agent uses — it is
   revocable independently of the account password and carries no console access.
4. Hand it to the platform as a company secret named `COMPLIANCE_MAILBOX_PASSWORD`
   (Paperclip → Company → Secrets). **Do not paste it into an issue comment or `.env`.**
5. Bind it onto the CISO agent's `adapterConfig.env` as a `secret_ref`:

```json
{
  "env": {
    "COMPLIANCE_MAILBOX_PASSWORD": { "type": "secret_ref", "secretId": "<uuid>" },
    "COMPLIANCE_MAILBOX_ADDRESS":  { "type": "plain", "value": "security@aira.io" },
    "COMPLIANCE_MAILBOX_PROFILE":  { "type": "plain", "value": "google" }
  }
}
```

Then verify — this must print `"ok": true` before the address goes on any RFQ:

```bash
python3 scripts/compliance_mailbox.py selftest
python3 scripts/compliance_mailbox.py roundtrip
```

### Why not Cloudflare Email Routing / a new domain

The Cloudflare token on this host is scoped to `liftedops.com` only and returns
`Authentication error` against everything else; `aira.io` is not on Cloudflare at all. And
routing `aira.io` mail elsewhere would fight the existing `p=reject` DMARC posture. Staying
inside the Workspace that already owns the domain is both faster and the correct ISO 27001
answer — the RFQ should carry a corporate address on the certified domain.

---

## 5. Phone contact

No Aira phone number exists anywhere in the repo, the Drata roster, or agent memory. There is
nothing to report and nothing an agent can provision — buying a number is a purchasing
decision with a recurring cost.

Two acceptable outcomes, Ben's call (asked on RBR-759):

- **Provision a number** — a Google Voice number on the Workspace ($10/user/mo) keeps the
  identity durable and role-based, consistent with the mailbox.
- **Document the omission** — legitimate and low-risk here. Aira is remote-first with no
  office; A-LIGN and Schellman both accept web-form and email intake, and every RFQ response
  path we need is email. Recommended wording for the RFQ:

  > *Aira is a remote-first organisation; email is our preferred and fastest contact channel.
  > A phone number can be provided on request for scheduling.*

Omission is the recommended default. It should not hold the RFQ.

---

## 6. Usage once provisioned

```bash
# Check an address BEFORE relying on it — no credential required.
# Exit 1 means at least one address is a group/alias and can never be read by an agent.
python3 scripts/compliance_mailbox.py probe security@aira.io compliance@aira.io --evidence

# Send the A-LIGN RFQ with the PDF attached
python3 scripts/compliance_mailbox.py send \
  --to proposals@a-lign.com \
  --subject "ISO 27001:2022 Certification RFQ — Aira (Rambur Inc.)" \
  --body-file data/rbr-758-dispatch/align-cover-message.txt \
  --attach  data/rbr-758-dispatch/align-rfq.pdf

# Watch for the reply
python3 scripts/compliance_mailbox.py inbox --limit 20
python3 scripts/compliance_mailbox.py read --uid <uid> --json
```

---

## 7. Verification evidence

Because `security@aira.io` does not exist yet, the harness was proven end-to-end against a
live IMAP/SMTP server (local Proton Bridge) to show the code path is correct and the
remaining gap is purely provisioning.

```
$ python3 scripts/compliance_mailbox.py selftest
  imap_login  ok   66 folders visible
  smtp_login  ok   authenticated
  "ok": true

$ python3 scripts/compliance_mailbox.py roundtrip
  "ok": true
  token             RBR-759-32F9F6F40E2C
  sent_message_id   <178595893371.65395.6245436204336245098@benandcassandra.com>
  sent_at           2026-08-05T19:42:19Z
  retrieved_at      2026-08-05T19:42:51Z
  latency_seconds   31.6
  retrieved.folder  INBOX
  retrieved.message_id  <178595893371.65395.6245436204336245098@benandcassandra.com>   # identical
```

Sent over SMTP, retrieved over IMAP by matching `Message-ID`, then `read` returned the full
body. Send and agent-readable-inbound are both demonstrated; only the mailbox identity is
outstanding.

Evidence file: `data/evidence/rbr-759-mailbox-roundtrip-20260805T194213Z.json`

### Address probe (re-run, with control)

```
$ python3 scripts/compliance_mailbox.py probe \
    security@aira.io compliance@aira.io it@aira.io ben.hamilton@aira.io --evidence
  security@aira.io       alias_or_group   Lookup failed
  it@aira.io             alias_or_group   Lookup failed
  compliance@aira.io     indeterminate    [AUTHENTICATIONFAILED] Invalid credentials
  ben.hamilton@aira.io   indeterminate    [AUTHENTICATIONFAILED] Invalid credentials
  control (nonexistent)  indeterminate    [AUTHENTICATIONFAILED] Invalid credentials
  "ok": false            exit 1
```

The control address returning the same state as `ben.hamilton@` is the whole point — see
§2.2.1. Evidence file: `data/evidence/rbr-759-address-probe-20260805T201310Z.json`

Also verified: a missing credential exits `2` naming all three resolution options and
never falls back to a `.env` literal, and the `google` profile resolves the correct
Workspace endpoints (`imap.gmail.com:993` TLS, `smtp.gmail.com:587` STARTTLS).
