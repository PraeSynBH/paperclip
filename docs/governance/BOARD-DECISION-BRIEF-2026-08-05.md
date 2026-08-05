# Board Decision Brief — Rambur, Inc. (RBR)

**Prepared by:** CEO · **Date:** 2026-08-05 · **For:** Ben Hamilton (board)

---

## The finding

The board is not the bottleneck. **The queue is.**

There are **79 pending interactions** awaiting board response across **161 open issues**.
**55 of them (70%) are more than 14 days old.** Fifteen date from July 9 — the first day of
the programme.

No human can triage 79 items, so none get triaged, so agents file more — several of which
restate decisions already sitting in the queue under a different issue number. That is the
loop we are in. I am not asking you to answer 79 things. I am asking you to answer **8**.

Of the 79:

| | interactions |
|---|---|
| Genuinely distinct decisions still needed (**8 decisions**) | **9** |
| Duplicates / superseded / expired / test artifact → **decline** | **24** |
| Document & plan approvals (the long tail, mostly CISO/Compliance) | **46** |
| **Total** | **79** |

**Three of the 24 are actively dangerous** — accepting them causes irreversible harm. They are
listed first below.

---

## 1. DECLINE THESE THREE FIRST — accepting any of them destroys data

All three authorize the Drata device purge against an **unenumerated count** and a **stale
keep-list**. The "Unknown OS" filter they refer to returns **205** devices, of which **12 are
active-employee machines — including yours (device 844) and Austin's (845).**

| Issue | Interaction | Asks for | Why decline |
|---|---|---|---|
| RBR-660 | `14704166` | purge "188", 9-device keep-list | Keep-list is stale; 12 devices need protecting, not 9. Would delete 3 active machines. |
| RBR-592 | `3156ea58` | purge "188 former-employee" | Same unenumerated set. No device IDs exist behind the number. |
| RBR-654 | `b6147205` | purge "189 ghost devices" | Third conflicting count for the same set. |

**The correct version of this decision is item 2 in the decision list below.**

---

## 2. THE EIGHT DECISIONS THAT ACTUALLY NEED YOU

Ordered by how much they unblock. Everything else in the queue is downstream of these.

### D1 — ISO 27001 certification body: sender identity + dispatch route  ⚠️ CRITICAL PATH
**Answer interaction `dcd5d531` on RBR-398.** Three questions: your title on the From: line,
who physically submits the web forms, and whether the re-baselined Oct/Nov timeline is accepted.

This single answer collapses **8 queue items** (RBR-398 ×2, RBR-381 ×2, RBR-382, RBR-189,
RBR-216, RBR-217) that have all been asking the same thing since July 11.

Both RFQs are content-clean and independently verified (I re-ran the sanitization grep myself
this run — zero matches). CISO is packaging them for the actual web-form channel under RBR-758
right now. **Nothing else blocks dispatch but your answer.**

> Cost of continued delay: this is the gate on Stage 1 (Oct 6–24) → Stage 2 (Nov) →
> certificate (Dec 2026–Jan 2027). Auditor lead time is 6–12 weeks and does not compress.
> The proposal deadline currently printed in both RFQs is **Aug 12** — if you answer after
> ~Aug 8, tell me and I will re-baseline the date *before* dispatch. Mailing an auditor a
> deadline that has already passed is exactly the kind of thing a certification body scores us on.

### D2 — Approve the Drata orphan device purge (the enumerated version)
**Accept interaction `c7698716` on RBR-730. Decline `ec543c23` (the superseded 190 version).**

I verified this end to end this run rather than taking the report:
- The delete list is **193 enumerated device IDs**, not a count — `data/RBR-730-FINAL-delete-list-193.csv`
- Purge set ∩ keep set = **0 overlap**; 193 + 12 = 205 = the full Unknown-OS universe
- **Zero `CURRENT_EMPLOYEE` devices** in the delete list
- The stated shortcut rule (*delete `deviceId ≤ 871`, skip the 12 listed*) **provably reproduces
  the enumerated list exactly** — I re-derived it from the CSVs and diffed. Clean.

Safe to approve as written. Runbook: `data/RBR-730-board-purge-runbook.md`.

### D3 — Store `GEMINI_API_KEY` as a company secret
**Accept `da38b032` on RBR-714. Decline `21b98c12` on RBR-126.**

`21b98c12` asks you to provision a GCP project, enable Vertex AI, and create an
`ai-platform.user` service account. **The migration needs none of those.** That ask was my
error — I read the plan document instead of the shipped code. `gemini-with-key.sh` uses plain
AI Studio key auth and never references Vertex or `GOOGLE_CLOUD_PROJECT`. Real ask: one AI
Studio key, ~60 seconds. Also decline `84e161f9` on RBR-127 — it restates my retracted
"CTO stalled" framing.

> Note: this does **not** immediately start the canary. RBR-738 must first prove the OpenRouter
> fallback path actually fires — it has never been executed end to end, and if it is broken a
> Gemini outage takes every migrated agent offline. That ordering is my call and it is firm.

### D4 — GCP project ID + read-only service account (for Drata evidence collection)
**Answer `36f28e68` on RBR-70. Decline `99f17ad0` (RBR-72), `a3670d83` (RBR-74), `f78218ca` (RBR-485).**

Unrelated to D3 despite both saying "GCP" — this one is the evidence collector for 22 Annex A.8
controls. RBR-70 carries the full security-reviewed spec (8 IAM roles, all read-only,
least-privilege). The other three are bare restatements of the same request.

### D5 — Drata API key scopes
Two live, genuinely different asks:
- **`a0d67625` (RBR-572)** — expand scopes for Custom Connections
- **`90c6ab86` (RBR-705)** — create a **write-scope** key for evidence upload

**Decline `d5b2fad4` (RBR-19) and `c56a62ec` (RBR-155)** — both request a *read-scope* key that
already exists and is working (it produced the D2 device list this morning).

### D6 — Endpoint management budget
Two separate purchases; please treat them separately:
- **`c8e3e747` (RBR-91)** — Jamf Pro, $10–15K/yr, 119 macOS devices. Closes NC-009.
- **`698d777a` (RBR-92)** — Windows 11 Pro + M365, ~$9.2K one-time. Re-derived from live Drata data today.

**Decline `0a604ccf` (RBR-88)** — MDM evaluation acceptance, superseded by the actual budget ask.
**Decline `41c268ba` (RBR-596)** — empty payload, duplicate of RBR-91.

### D7 — ISMS Owner appointment  🔎 needs a correction before you approve
RBR-20 has **two confirmations pointing at the same plan revision** (`0ec1772c`) — `88897f65`
and `dc010c67`. Decline one as a duplicate.

**But do not approve either as written.** Both describe appointing the CISO as ISMS Owner
*"for the Arrowhead project."* This is the **Aira** ISO 27001 ISMS. Appointing an ISMS Owner
against the wrong scope is precisely the kind of documentation defect a certification body
writes up under Clause 5.3. I will have this corrected and re-presented.

### D8 — Clear the test artifact
**Decline `e9425de6` on RBR-365.** Its entire payload is the string `"Test"`. It has been
occupying a board slot for 25 days.

---

## 3. The long tail (46 items) — a proposal, not a request

The remaining 46 are document and plan approvals: policies, procedures, evidence packs, training
modules, SoA, internal audit report. Individually reasonable; collectively unanswerable.

Most are ISMS artifacts that a certification body will want to see **approved by management**.
So they do need a real signature — but not 46 separate ones.

**I propose:** I batch them into a single ISMS document approval pack, ordered by whether Stage 1
actually depends on them, and bring you **one** approval covering the set, with the handful that
need individual judgement broken out. That replaces 46 decisions with roughly 3.

Tell me to proceed and I will have it built. I have not started it — it is a real chunk of work
and I would rather not spend it if you want a different cut.

---

## 4. Two operational flags (no decision needed, visibility only)

- **Staff Engineer agent is in `error` state** (since 18:50 UTC today). RBR-738 — the Gemini
  fallback proof, and the gate on D3's downstream work — was auto-moved to `blocked` by Paperclip
  recovery with no live execution path. Recovery owner is the CTO. I cannot write to that issue
  (authorization boundary, `403`), so I am surfacing it here rather than silently leaving it.
- **I cannot decline interactions myself.** `POST /issues/{id}/interactions/{id}/cancel` returns
  `403 — Agent actors cannot resolve issue-thread interactions through this board-only route`.
  Every "decline" above therefore needs your click. That routing rule is why 24 dead items
  accumulated: no agent can clean up after itself.

---

## What I did this run, in one line

Audited all 79 pending board asks against their source artifacts, found 24 dead or dangerous
(3 destructive), verified the 2 live destructive ones are now safe and enumerated, and reduced
the board's queue from 79 items to 8 decisions.
