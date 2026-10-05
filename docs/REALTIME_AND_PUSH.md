# Realtime, push notifications and DM delivery

How Activity and direct messages reach people quickly: a WebSocket while the app is open, push notifications while it isn't, and polling only as a fallback. Phase 3 added all three, along with reliable DM sending.

## Overview

```
 API instance A ──┐                        ┌── WebSocket ── phone (foreground)
 API instance B ──┼── pg_notify('realtime') ┤
 worker ──────────┘          │              └── (other instances' sockets)
                             │
   write + event in one SQL statement (messages, notifications, receipts)
                             │
                    push_outbox row ── NOTIFY push_outbox ── worker ── FCM / APNs ── phone (background)
```

- Events are produced **inside the SQL statement that writes the data** (`pg_notify` in the same CTE), so an event exists only if the write committed, and a push is queued in the same transaction as the message or notification it announces.
- Every API instance `LISTEN`s on one dedicated connection and forwards events to its own sockets, so users connected to different instances still reach each other. No sticky sessions, no Redis.
- Events carry **ids only, never message text**. Clients fetch content through the REST API, where every authorization rule (blocks, privacy, participation) applies.

## Realtime connection (`/api/v1/realtime`)

| | |
|---|---|
| Server | `backend/src/realtime/hub.ts` (`ws` 8.22, attached to the API's HTTP server) |
| Auth | `Authorization: Bearer <access token>` header, or `?ticket=` from `POST /api/v1/realtime/ticket` (single use, 60 s, stored hashed). The app uses tickets. |
| Events | `hello {userId, serverTime, expiresAt}`, `message {conversationId, messageId, senderId, createdAt}`, `receipt {conversationId, userId, lastReadAt, lastDeliveredAt}`, `notification {id, kind}`, `resync`, `pong` |
| Close codes | `4001` token expired (reconnect with a fresh ticket), `4401` sign-in ended, `4409` replaced (over 10 sockets for one user; the oldest goes), `1001` server shutdown |
| Liveness | Server pings every 30 s and drops sockets that miss a pong; phones can't see ping frames, so the app sends `{"type":"ping"}` every 25 s and expects `{"type":"pong"}` (at most one pong per 5 s per socket). |
| Revocation | Sessions are re-checked every 60 s, and **immediately** when a sign-in ends, an account is suspended or deleted: triggers in migration 0031 publish `_revalidate`, which closes affected sockets with `4401` within a second or two. |
| Limits | 10 sockets per user, 4 KB max inbound frame, upgrades go through the global rate limiter. |
| Missed events | If the server's `LISTEN` connection drops, it reconnects and sends `resync` to every socket. The app also resyncs after every reconnect. |

## DMs

- **Idempotent sends**: the app sends `clientMessageId` (16–64 of `[A-Za-z0-9_-]`) with each message. A retry with the same id returns the stored message (`200`) instead of a duplicate (`201` for a new one), even when retries race. The same id with different content is `409`. The id is returned to its sender only.
- **Stable paging**: `GET /api/v1/conversations/:id/messages?before=<messageId>` (older) and `?after=<messageId>` (newer) return newest-first pages with `hasMore`, and don't shift as messages arrive. Offset paging still works for older clients.
- **Receipts**: fetching messages marks them delivered; `POST …/read` marks them read. When that changes what the other person sees, both participants get a `receipt` event.
- **Search**: `GET /api/v1/conversations?q=` matches the other person's username or display name. `%` and `_` are literal (the same fix was applied to people search and Admin searches).
- **By id**: `GET /api/v1/conversations/:id` returns the other participant, for opening a thread from a notification. Malformed ids are `404`, never a server error.
- **Privacy**: no Admin, moderation or Ads endpoint returns message text. A Super Admin crawl of every such GET route proves it (`backend/test/dmPrivacy.test.ts`), and a static check fails the build if any module other than `conversations` starts reading the DM tables. There is no Admin workflow that grants access to DMs. Users can report a person, but not attach a specific message to a report (a gap for Phase 4).

## Push notifications

| | |
|---|---|
| Devices | `POST /api/v1/push/devices {provider, platform, token, appVersion?, locale?}` (201 new, 200 refreshed); `POST /api/v1/push/devices/unregister`. A token that reappears under another account **moves** to it, so a shared phone never gets the previous person's pushes. Devices are bound to the sign-in that registered them: when it ends (sign-out, password change, revocation) or the account is deleted, a trigger disables them. |
| Queue | `push_outbox`, written in the same statement as the notification or message. The worker claims batches with `FOR UPDATE SKIP LOCKED` and is woken by `NOTIFY push_outbox` (5 s polling as a safety net). |
| Text | Written at send time from current data: `@name liked your Story`, `…commented on your Story`, `…mentioned you in a comment`, `…started following you`, `…requested to follow you`, `…sent you a message`. **Message text is never included.** Renamed users show their current name, and blocked, deleted or suspended actors are skipped. |
| Preferences | `pushEnabled` (all pushes) and `messagesEnabled` (DM pushes), checked when each push is sent, so they apply to every device at once. The Activity type toggles still decide whether a notification exists at all. |
| Payload | `data.url` is a `katkee://conversation/<id>`, `katkee://story/<id>`, `katkee://user/<name>` or `katkee://activity` link. Collapse keys are `dm-<conversation>`, so a burst of messages replaces one notification, and the badge is unread Activity plus unread conversations. |
| Providers | **FCM HTTP v1** (OAuth2 JWT-bearer with the service account, RS256, cached access token, re-minted once on 401) for Android **and iOS**: the app registers FCM tokens on both, and FCM reaches iPhones through APNs. **APNs** HTTP/2 with an ES256 provider token is also built in, for clients that register raw APNs tokens. |
| Failures | Tokens the provider reports gone (FCM `UNREGISTERED`/404, APNs 410/`BadDeviceToken`/`Unregistered`) are disabled. 429 and 5xx retry after 15 s, 60 s, 4 min and 16 min, for 5 attempts in total. |
| Retention | Expired tickets, outbox rows finished over 30 days ago, and devices disabled over 90 days ago are deleted by the hourly retention run. |

## Mobile app

- `src/realtime/realtimeClient.ts` holds the socket: ticket auth; backoff of 1, 2, 4 … 30 s with jitter, reset after a good connection; a 15 s handshake timeout; the app-level ping; and the close-code policy above. `RealtimeProvider` keeps it connected while the user is signed in and the app is in the foreground. It closes 15 s after the app goes to the background, where push takes over.
- **Badges** (Activity, DM) and open screens refresh on events. Polling remains only as a fallback: every 20 s for badges and 4 s in an open thread while the socket is down, or a 2 min and 30 s safety net while it's up.
- **DM outbox** (`src/state/dmOutbox.ts`): every message is saved on the phone with its id before sending. If it was written offline or the app was killed mid-send, it is still stored exactly once. Messages go in order within a thread. Temporary failures retry with backoff, and again immediately when the app returns or the socket reconnects. Refusals (blocked, invalid) wait for the person to retry or delete them. Sign-out clears the account's unsent messages.
- **Push** (`src/push/pushNotifications.ts`): `@react-native-firebase/messaging` 26.4.0. Permission is requested **once, in context**: the first visit to Messages or Activity, never at launch. Settings → Notifications shows the phone's permission and links to system settings when it's off. Tapping a notification opens its `katkee://` link; only the four known link shapes are followed. Sign-out unregisters the device and deletes the FCM token. A build without Firebase config files runs normally, with push off.

## Setup

1. **Firebase project.** Add an Android app (`com.katkee.development`, or the release id) and an iOS app (same bundle id). Upload the **APNs auth key** (.p8) under *Project settings → Cloud Messaging*.
2. **Android:** put `google-services.json` in `mobile/android/app/`. The Gradle plugin is applied only when the file exists. The file is git-ignored.
3. **iOS:** add `GoogleService-Info.plist` to the `KatkeeMobile` target in Xcode (*Copy Bundle Resources*); it is git-ignored. Enable the *Push Notifications* capability on the App ID; the entitlements file already sets `aps-environment`, which distribution signing switches to production. Run `pod install`: Firebase needs static frameworks, which the Podfile now defaults to.
4. **Server:** set `FCM_SERVICE_ACCOUNT_JSON` (a service account with the *Firebase Cloud Messaging API Admin* role, as JSON or base64) on the **worker**, which sends the pushes. The production compose file passes it, and the `APNS_*` variables for direct APNs. `FCM_ENDPOINT`/`APNS_HOST` exist for local test servers and are refused in production.
5. **Proxy:** Caddy proxies WebSocket upgrades as-is. With an AWS ALB, keep the idle timeout above 30 s (the server pings every 30 s).

## Verification

- Backend: `backend/test/realtime.test.ts` (handshake auth, single-use tickets, message/receipt/notification events with no text, cross-instance delivery, immediate close on sign-out, suspension and token expiry, pong rate, socket cap); `push.test.ts` (local FCM/OAuth and HTTP/2 APNs servers that **verify the RS256 and ES256 signatures**: device registry, DM push on both providers without text, dead tokens, preferences, blocks, retry with backoff, token re-mint, idempotent DM sends); `dmReliability.test.ts`; `dmPrivacy.test.ts`.
- Mobile logic: `verification/dm-outbox.cjs`, `realtime-client.cjs`, `dm-thread.cjs`, `push-notifications.cjs`, `account-links.cjs`.
- **Not verified here:** live FCM/APNs delivery (no credentials), and behavior on physical devices: background, network switches, notification taps and the native Android/iOS builds with Firebase. See `docs/phases/PHASE_3_REALTIME_PUSH.md`.
