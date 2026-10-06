# Moderation, appeals and abuse protection

Spec section 13. Implemented in Phase 4 (October 2026). Report: `docs/phases/PHASE_4_MODERATION_ADS_ANALYTICS.md`.
Everything here is enforced on the server; the Admin Console and the app only call it.

## Reports

- **What can be reported**: Stories, comments, profiles (including impersonation), Sponsored
  Stories, and a specific direct message (see below).
- **Reasons**: spam, harassment, nudity, violence, hate speech, self-harm, impersonation, scam,
  other. `POST /api/v1/reports` → 201 for a new report, 200 when the person already has an open
  report on the same item (one open report per reporter and item; a unique index enforces it).
- **Priority** is set by the database when a report arrives: self-harm 3; violence, hate speech
  and nudity 2; harassment, impersonation and scam 1; others 0; +1 once three or more different
  people have open reports on the same item (and the earlier reports are raised too). The queue
  is ordered by priority, then age, and can be filtered by minimum priority.

### Lifecycle

`OPEN` → `UNDER_REVIEW` (a moderator claims it; concurrent claims are refused) →
`ACTIONED` or `DISMISSED` → (`APPEALED` when the person appeals an action) → `CLOSED`.
Every transition uses the report's version number, so two moderators cannot both act on the
same report; the second gets 409. The older lowercase status names are still accepted in filters.

### Moderator workspace (Admin Console → Reports)

A report opens with the content preview, the creator (join date, state, followers, previous
actions against them, their other open reports), the item's history (other reports, previous
actions, appeals), moderator notes (append-only), and the decision. Actions: keep (dismiss),
remove content, restrict account, suspend account, and restore where permitted. Removed content
stops being served immediately (owners included). Every action and note is written to the
immutable, hash-chained audit log.

### Appeals

People see the actions taken against them in **Settings → Appeals** and can appeal removals,
restrictions and suspensions (suspended accounts confirm their password to reach the form).
A moderator then **upholds** or **denies** it (`POST /api/v1/admin/appeals/:id`, recent
re-authentication required). Upholding reverses the action in the same transaction: a Story or
comment comes back if it is still moderation-removed and its owner is active, an ad creative
returns to APPROVED, and a restricted or suspended account returns to ACTIVE if it is still in
that state. Upholding needs the permission that would have reversed the action directly
(`content.restore`, `ads.review`, `users.restrict` or `users.suspend`). Either decision closes
the report and is audited (`APPEAL_UPHELD` / `APPEAL_DENIED`).

## Reporting a direct message (documented safety workflow)

Private messages are never browsable by Admins and never used for ads (tested by
`backend/test/dmPrivacy.test.ts`, which crawls every Admin/moderation/Ads route). The one
exception is what a participant chooses to report:

1. A person long-presses a message they received, chooses **Report**, a reason and optional
   details. The app tells them the reported message and the 9 before it will be shared with
   Katkee's safety team.
2. `POST /api/v1/conversations/:id/report` (participants only) copies that message and up to
   9 earlier messages of the same conversation into `report_message_evidence`, in one
   statement, and opens a report with source `direct_message`. Reporting again adds evidence
   to the same open report.
3. The report detail shows only the number of attached messages. Reading them needs the
   separate permission `reports.messages.read`, is answered with `Cache-Control: no-store`,
   and writes a `DM_EVIDENCE_VIEWED` audit record naming the moderator.
4. Evidence text is purged 180 days after the report is resolved
   (`RETENTION_MODERATION_EVIDENCE_DAYS`); the purge is a worker task and is tested.

## Abuse protection

### Per-account budgets (shared across API instances)

One database round trip per action checks a per-minute and a per-hour budget
(`consume_rate_limit`, PostgreSQL). Accounts younger than 24 hours get a lower hourly budget.
Over budget: 429 with `Retry-After`.

| Action | Per minute | Per hour | New accounts per hour |
|---|---:|---:|---:|
| Like | 60 | 600 | 150 |
| Comment | 10 | 120 | 30 |
| Follow | 20 | 200 | 50 |
| Message | 30 | 400 | 100 |
| New conversation | – | 40 | 10 |
| Story view | 120 | 2,400 | – |

Override with `SAFETY_LIMITS_JSON`, e.g. `{"comment":{"perMinute":5,"perHour":60,"newAccountPerHour":20}}`.

- **Fake views**: a view over budget is skipped silently (the viewer is not told), so view
  counts cannot be inflated by scripting.
- **Copy-paste spam**: the same comment (case- and whitespace-insensitive) posted three times
  within an hour is refused.
- **Notification spam**: a like or follow from the same person on the same item notifies at most
  once every 7 days (like/unlike/like loops stay quiet).
- **Reports**: 30 an hour per person (ads: 20), counted per API instance; duplicates collapse
  into the open report.

### Links

Applied to comments, DMs, captions and text on Stories, bios, and ad destinations, in this order:

1. Dangerous schemes are refused everywhere (`javascript:`, `vbscript:`, `data:` URLs, `file://`).
2. Accounts younger than 24 hours cannot post links in comments or messages.
3. Punycode (`xn--`) domains are refused from accounts younger than 7 days (look-alike domains).
4. Domains on the Admin blocklist (**Admin Console → Link safety**, permission
   `safety.settings.manage`, audited), including their subdomains.
5. Google Safe Browsing (Lookup API v4) when `SAFE_BROWSING_API_KEY` is set: results cached;
   if the service is unreachable the link is allowed and `link_reputation_unavailable` is logged
   (fail-open, so an outage does not block posting).

Refusals are 422 with a plain message ("Links to scam.example aren't allowed on Katkee.").

### Not implemented

- Device attestation (Play Integrity / App Attest) and CAPTCHA for signup: NOT IMPLEMENTED
  (needs provider keys and native builds). Signup is rate-limited per IP; new accounts get the
  lower budgets above.
- Live Safe Browsing: BLOCKED without an API key (the integration is tested against a local server).

## Permissions

| Permission | Allows |
|---|---|
| `reports.read` | the queue and report detail |
| `reports.review` | claim, decide, notes, appeals |
| `reports.messages.read` | read DM evidence attached by a reporter (audited) |
| `content.remove` / `content.restore` | remove / restore content |
| `users.restrict` / `users.suspend` | restrict / suspend and reverse |
| `moderation.history.read` | the action history |
| `safety.settings.manage` | the link blocklist |
