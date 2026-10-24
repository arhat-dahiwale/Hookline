# Hookline: API Reference

Everything callable, in one place. **Any change to a route, procedure, RPC, or message must update this file in the same change.**

| Surface          | Audience                           | Auth                | Base                             |
| ---------------- | ---------------------------------- | ------------------- | -------------------------------- |
| REST             | Integrators (public)               | API key             | `/v1`                            |
| tRPC             | Dashboard (Next.js)                | Better Auth session | `/trpc`                          |
| Better Auth      | Dashboard                          | n/a (it _is_ auth)  | `/api/auth/*`                    |
| WebSocket        | Dashboard                          | Better Auth session | `/ws`                            |
| gRPC             | API role to worker role (internal) | Shared token        | `WORKER_GRPC_URL`                |
| Operational      | Infra                              | none or internal    | `/health/*`, `/metrics`, `/docs` |
| Webhook delivery | What customers' servers receive    | HMAC signature      | n/a                              |

---

## 1. REST API (public)

### 1.1 Conventions

- **Auth:** `Authorization: Bearer hl_live_{prefix}_{secret}`
- **Content type:** `application/json`
- **IDs:** prefixed strings (`evt_...`, `end_...`, `dlv_...`, `att_...`)
- **Timestamps:** ISO 8601 UTC
- **Pagination:** `?limit=` (1 to 100, default 50) and `?cursor=`. Response: `{ "data": [...], "nextCursor": "..." | null }`
- **Request ID:** every response has `X-Request-Id`
- **Rate limit headers:** `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (seconds)
- **Idempotency:** `Idempotency-Key` header (max 255 chars) on `POST /v1/events`

### 1.2 Error format

```json
{
  "error": {
    "code": "validation_error",
    "message": "payload exceeds 256 KB",
    "details": [{ "path": "payload", "message": "too large" }],
    "requestId": "req_01J..."
  }
}
```

| HTTP | `code`                  | Meaning                                         |
| ---- | ----------------------- | ----------------------------------------------- |
| 400  | `validation_error`      | Body or query failed validation                 |
| 401  | `unauthorized`          | Missing, invalid, expired, or revoked key       |
| 403  | `forbidden`             | Key lacks the required scope                    |
| 404  | `not_found`             | Resource doesn't exist in this organization     |
| 409  | `conflict`              | State conflict (e.g. endpoint already disabled) |
| 413  | `payload_too_large`     | Body over 256 KB                                |
| 422  | `idempotency_key_reuse` | Same key, different payload                     |
| 422  | `endpoint_url_blocked`  | URL failed SSRF or HTTPS rules                  |
| 429  | `rate_limited`          | Too many requests (see `Retry-After`)           |
| 500  | `internal_error`        | Unexpected error                                |
| 503  | `unavailable`           | Dependency down or shutting down                |

### 1.3 Events

| Method | Path                              | Scope              | Description                                 |
| ------ | --------------------------------- | ------------------ | ------------------------------------------- |
| POST   | `/v1/events`                      | `events:write`     | Ingest an event and fan out                 |
| GET    | `/v1/events`                      | `events:read`      | List events (filters: `type`, `from`, `to`) |
| GET    | `/v1/events/{eventId}`            | `events:read`      | Get one event                               |
| GET    | `/v1/events/{eventId}/deliveries` | `deliveries:read`  | Deliveries for an event                     |
| POST   | `/v1/events/{eventId}/replay`     | `deliveries:write` | Replay to all matching (or given) endpoints |

**POST /v1/events**

Request:

```json
{
  "type": "invoice.paid",
  "payload": { "invoiceId": "inv_123", "amount": 4900 },
  "endpointIds": ["end_..."]
}
```

- `type` required, format `^[a-z0-9_]+(\.[a-z0-9_]+)*$`, max 128
- `payload` required, any JSON object, max 256 KB
- `endpointIds` optional, restricts fan-out to specific endpoints

Response `202 Accepted`:

```json
{
  "id": "evt_01J...",
  "type": "invoice.paid",
  "createdAt": "2026-10-24T10:00:00.000Z",
  "deliveries": [{ "id": "dlv_01J...", "endpointId": "end_...", "status": "pending" }]
}
```

A replayed idempotent request returns `200` with the original body and header `Idempotent-Replay: true`.

**POST /v1/events/{eventId}/replay**: body `{ "endpointIds": ["end_..."] }` (optional). Response `202` with the new deliveries.

### 1.4 Endpoints

| Method | Path                                       | Scope              | Description                                     |
| ------ | ------------------------------------------ | ------------------ | ----------------------------------------------- |
| POST   | `/v1/endpoints`                            | `endpoints:write`  | Create (returns the secret once)                |
| GET    | `/v1/endpoints`                            | `endpoints:read`   | List                                            |
| GET    | `/v1/endpoints/{endpointId}`               | `endpoints:read`   | Get one (no secret)                             |
| PATCH  | `/v1/endpoints/{endpointId}`               | `endpoints:write`  | Update fields                                   |
| DELETE | `/v1/endpoints/{endpointId}`               | `endpoints:write`  | Soft delete (cancels in-flight deliveries)      |
| POST   | `/v1/endpoints/{endpointId}/enable`        | `endpoints:write`  | Enable (also resets the breaker)                |
| POST   | `/v1/endpoints/{endpointId}/disable`       | `endpoints:write`  | Disable manually                                |
| POST   | `/v1/endpoints/{endpointId}/rotate-secret` | `endpoints:write`  | Rotate; old secret valid for the grace window   |
| POST   | `/v1/endpoints/{endpointId}/test`          | `endpoints:write`  | Send a sample event synchronously               |
| GET    | `/v1/endpoints/{endpointId}/health`        | `endpoints:read`   | Breaker state and recent stats                  |
| POST   | `/v1/endpoints/{endpointId}/replay-failed` | `deliveries:write` | Bulk replay `dead` deliveries (filters in body) |

**Endpoint object**

```json
{
  "id": "end_01J...",
  "url": "https://example.com/hooks",
  "description": "Production",
  "status": "active",
  "eventTypes": ["invoice.*"],
  "timeoutMs": 10000,
  "maxAttempts": 8,
  "rateLimitPerSecond": 10,
  "metadata": {},
  "createdAt": "...",
  "updatedAt": "..."
}
```

**POST /v1/endpoints** body: `url` (required), `description`, `eventTypes`, `timeoutMs`, `maxAttempts`, `rateLimitPerSecond`, `metadata`. Response `201` is the endpoint object plus `"secret": "whsec_..."` (shown once).

**POST .../rotate-secret** body: `{ "gracePeriodHours": 24 }` (optional, 0 to 168). Response includes the new `secret` (once).

**POST .../test** response:

```json
{
  "outcome": "success",
  "responseStatus": 200,
  "durationMs": 143,
  "responseBodySnippet": "ok",
  "error": null
}
```

**GET .../health** response:

```json
{
  "state": "closed",
  "consecutiveFailures": 0,
  "lastSuccessAt": "...",
  "lastFailureAt": null,
  "openedAt": null,
  "stats24h": { "attempts": 1200, "succeeded": 1188, "failed": 12, "p95Ms": 310 }
}
```

### 1.5 Deliveries

| Method | Path                                   | Scope              | Description                                                     |
| ------ | -------------------------------------- | ------------------ | --------------------------------------------------------------- |
| GET    | `/v1/deliveries`                       | `deliveries:read`  | List (filters: `status`, `endpointId`, `eventId`, `from`, `to`) |
| GET    | `/v1/deliveries/{deliveryId}`          | `deliveries:read`  | Get one                                                         |
| GET    | `/v1/deliveries/{deliveryId}/attempts` | `deliveries:read`  | All attempts                                                    |
| POST   | `/v1/deliveries/{deliveryId}/replay`   | `deliveries:write` | Replay (creates a linked new delivery)                          |

**Delivery object**

```json
{
  "id": "dlv_01J...",
  "eventId": "evt_...",
  "endpointId": "end_...",
  "replayOfDeliveryId": null,
  "status": "retrying",
  "attemptCount": 2,
  "maxAttempts": 8,
  "nextAttemptAt": "...",
  "lastAttemptAt": "...",
  "completedAt": null,
  "lastResponseStatus": 503,
  "lastError": null,
  "createdAt": "..."
}
```

**Attempt object**

```json
{
  "id": "att_01J...",
  "deliveryId": "dlv_...",
  "attemptNumber": 2,
  "outcome": "http_error",
  "requestHeaders": { "...": "..." },
  "responseStatus": 503,
  "responseHeaders": { "...": "..." },
  "responseBodySnippet": "Service Unavailable",
  "errorMessage": null,
  "durationMs": 212,
  "startedAt": "...",
  "finishedAt": "..."
}
```

### 1.6 Operational routes

| Method | Path            | Auth                              | Description                                     |
| ------ | --------------- | --------------------------------- | ----------------------------------------------- |
| GET    | `/health/live`  | none                              | Process is up                                   |
| GET    | `/health/ready` | none                              | Postgres and Redis reachable, not shutting down |
| GET    | `/metrics`      | internal network only             | Prometheus metrics (blocked at nginx)           |
| GET    | `/docs`         | none (disable in prod if desired) | Swagger UI                                      |
| GET    | `/openapi.json` | none                              | OpenAPI spec                                    |

---

## 2. Better Auth routes

Mounted at `/api/auth/*` and handled by Better Auth. Main routes used:

| Method | Path                                        | Description                |
| ------ | ------------------------------------------- | -------------------------- |
| POST   | `/api/auth/sign-up/email`                   | Sign up                    |
| POST   | `/api/auth/sign-in/email`                   | Sign in                    |
| POST   | `/api/auth/sign-out`                        | Sign out                   |
| GET    | `/api/auth/get-session`                     | Current session            |
| POST   | `/api/auth/organization/create`             | Create organization        |
| POST   | `/api/auth/organization/set-active`         | Switch active organization |
| POST   | `/api/auth/organization/invite-member`      | Invite a member            |
| POST   | `/api/auth/organization/update-member-role` | Change a member's role     |
| POST   | `/api/auth/organization/remove-member`      | Remove a member            |

The full list follows the Better Auth documentation for the enabled plugins. This table is updated when plugins change.

---

## 3. tRPC (dashboard)

Mounted at `/trpc`. Context contains `session`, `user`, and `activeOrganizationId`. All procedures require a session unless noted. Role minimums: **M** = member, **A** = admin, **O** = owner.

Inputs and outputs are Zod schemas exported from `packages/shared`.

> Phase status: the `endpoints` router is implemented (Phase 7). The remaining routers land with the phases that need them (events/deliveries/apiKeys: Phase 8, stats: Phase 11, audit/settings: Phase 8+).

| Router       | Procedure           | Type           | Role | Description                                    |
| ------------ | ------------------- | -------------- | ---- | ---------------------------------------------- |
| `endpoints`  | `list`              | query          | M    | Paginated list with filters                    |
|              | `get`               | query          | M    | One endpoint (no secret)                       |
|              | `create`            | mutation       | A    | Create. Returns the secret once                |
|              | `update`            | mutation       | A    | Update fields                                  |
|              | `delete`            | mutation       | A    | Soft delete                                    |
|              | `setStatus`         | mutation       | A    | Enable or disable                              |
|              | `rotateSecret`      | mutation       | A    | Rotate. Returns the new secret once            |
|              | `test`              | mutation       | M    | Test send (via gRPC to the worker role)        |
|              | `health`            | query          | M    | Breaker state and recent stats                 |
| `events`     | `list`              | query          | M    | Paginated, filters: type, time range           |
|              | `get`               | query          | M    | One event with payload                         |
|              | `send`              | mutation       | A    | Send a manual/test event from the UI           |
|              | `replay`            | mutation       | A    | Replay an event                                |
| `deliveries` | `list`              | query          | M    | Filters: status, endpoint, event, time range   |
|              | `get`               | query          | M    | One delivery                                   |
|              | `attempts`          | query          | M    | Attempts for a delivery                        |
|              | `replay`            | mutation       | A    | Replay one delivery                            |
|              | `replayBulk`        | mutation       | A    | Replay by filter (status, endpoint, range)     |
|              | `since`             | query          | M    | Updates after a timestamp (WebSocket backfill) |
| `apiKeys`    | `list`              | query          | A    | Keys (never the secret)                        |
|              | `create`            | mutation       | A    | Create. Returns the full key once              |
|              | `revoke`            | mutation       | A    | Revoke                                         |
| `stats`      | `overview`          | query          | M    | KPIs for a time range                          |
|              | `timeseries`        | query          | M    | Volume and success rate over time              |
|              | `latency`           | query          | M    | p50/p95/p99 over time                          |
|              | `endpointBreakdown` | query          | M    | Per-endpoint health table                      |
| `audit`      | `list`              | query          | A    | Audit log entries                              |
| `settings`   | `get` / `update`    | query/mutation | A    | Org-level settings (retention, defaults)       |

Errors map to tRPC codes (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `BAD_REQUEST`, `TOO_MANY_REQUESTS`, `INTERNAL_SERVER_ERROR`) carrying the same `code` strings as REST in `error.data.hooklineCode`.

---

## 4. WebSocket

**URL:** `wss://{host}/ws`
**Auth:** Better Auth session cookie at handshake. Unauthenticated sockets are closed with code `4401`.
**Scope:** server-enforced to the session's active organization.

### Close codes

| Code | Meaning                                        |
| ---- | ---------------------------------------------- |
| 1001 | Server shutting down (client should reconnect) |
| 4401 | Unauthorized                                   |
| 4403 | Forbidden subscription                         |
| 4429 | Too many connections for this user             |

### Client to server

```json
{ "op": "subscribe", "channel": "org" }
{ "op": "subscribe", "channel": "endpoint:end_01J..." }
{ "op": "subscribe", "channel": "event:evt_01J..." }
{ "op": "unsubscribe", "channel": "org" }
{ "op": "ping" }
```

Channels: `org` (everything in the organization), `endpoint:{id}`, `event:{id}`. The server verifies the resource belongs to the organization.

### Server to client

Envelope:

```json
{ "type": "delivery.attempt.completed", "ts": "2026-10-24T10:00:01.123Z", "data": {} }
```

| `type`                       | `data`                                                |
| ---------------------------- | ----------------------------------------------------- |
| `subscribed`                 | `{ channel }`                                         |
| `event.created`              | Event summary and delivery IDs                        |
| `delivery.created`           | Delivery object                                       |
| `delivery.status.changed`    | `{ deliveryId, status, attemptCount, nextAttemptAt }` |
| `delivery.attempt.completed` | Attempt object (headers and body snippet included)    |
| `endpoint.health.changed`    | `{ endpointId, state, reason }`                       |
| `endpoint.auto_disabled`     | `{ endpointId, reason }`                              |
| `pong`                       | `{}`                                                  |
| `error`                      | `{ code, message }`                                   |

**Heartbeat:** server sends a WS ping every 25 s. Clients not responding within 10 s are closed.
**Reconnect:** exponential backoff with jitter (1 s base, 30 s max). After reconnecting, the client resubscribes and calls `deliveries.since({ since })` to backfill.

---

## 5. gRPC (internal)

**Package:** `hookline.worker.v1`. **Server:** worker role. **Client:** API role.
**Auth:** metadata `x-internal-token: {INTERNAL_GRPC_TOKEN}`. Network-isolated. mTLS is future work.
**Deadlines:** the client sets a deadline on every call (default 15 s, 35 s for `TestEndpoint`).
Source of truth: `packages/proto/worker.proto`.

```proto
syntax = "proto3";
package hookline.worker.v1;

service WorkerService {
  rpc ReplayDelivery(ReplayDeliveryRequest) returns (ReplayDeliveryResponse);
  rpc ReplayEvent(ReplayEventRequest) returns (ReplayEventResponse);
  rpc TestEndpoint(TestEndpointRequest) returns (TestEndpointResponse);
  rpc GetEndpointHealth(GetEndpointHealthRequest) returns (GetEndpointHealthResponse);
  rpc StreamDeliveryAttempts(StreamDeliveryAttemptsRequest) returns (stream DeliveryAttemptEvent);
}

message ReplayDeliveryRequest {
  string organization_id = 1;
  string delivery_id = 2;
  bool wait_for_first_attempt = 3;   // block until the first attempt finishes
}
message ReplayDeliveryResponse {
  string new_delivery_id = 1;
  string status = 2;
  AttemptSummary first_attempt = 3;  // set if wait_for_first_attempt
}

message ReplayEventRequest {
  string organization_id = 1;
  string event_id = 2;
  repeated string endpoint_ids = 3;  // empty = all matching
}
message ReplayEventResponse { repeated string new_delivery_ids = 1; }

message TestEndpointRequest {
  string organization_id = 1;
  string endpoint_id = 2;
  string event_type = 3;             // defaults to "hookline.test"
}
message TestEndpointResponse {
  string outcome = 1;                // success | http_error | timeout | network_error | blocked
  int32 response_status = 2;
  int32 duration_ms = 3;
  string response_body_snippet = 4;
  string error = 5;
}

message GetEndpointHealthRequest { string organization_id = 1; string endpoint_id = 2; }
message GetEndpointHealthResponse {
  string state = 1;                  // closed | open | half_open
  int32 consecutive_failures = 2;
  string opened_at = 3;
  string last_success_at = 4;
  string last_failure_at = 5;
}

message StreamDeliveryAttemptsRequest { string organization_id = 1; string endpoint_id = 2; }
message DeliveryAttemptEvent {
  string delivery_id = 1;
  int32 attempt_number = 2;
  string outcome = 3;
  int32 response_status = 4;
  int32 duration_ms = 5;
  string finished_at = 6;
}

message AttemptSummary { string outcome = 1; int32 response_status = 2; int32 duration_ms = 3; }
```

**Error mapping**

| gRPC status                             | REST/tRPC code                      |
| --------------------------------------- | ----------------------------------- |
| `NOT_FOUND`                             | `not_found`                         |
| `INVALID_ARGUMENT`                      | `validation_error`                  |
| `PERMISSION_DENIED` / `UNAUTHENTICATED` | `internal_error` (misconfiguration) |
| `DEADLINE_EXCEEDED` / `UNAVAILABLE`     | `unavailable`                       |
| `RESOURCE_EXHAUSTED`                    | `rate_limited`                      |

**Health:** standard `grpc.health.v1.Health` service is exposed on the worker.

---

## 6. Outbound webhook contract (what customers receive)

### Request

`POST {endpoint.url}` with `Content-Type: application/json`.

| Header                 | Description                                                 |
| ---------------------- | ----------------------------------------------------------- |
| `User-Agent`           | `Hookline/1.0`                                              |
| `Hookline-Event-Id`    | `evt_...`                                                   |
| `Hookline-Event-Type`  | e.g. `invoice.paid`                                         |
| `Hookline-Delivery-Id` | `dlv_...`, **stable across retries**. Use for deduplication |
| `Hookline-Attempt`     | 1-based attempt number                                      |
| `Hookline-Timestamp`   | Unix seconds when this attempt was signed                   |
| `Hookline-Signature`   | `v1={hex}`, space-separated if multiple (during rotation)   |

Body:

```json
{
  "id": "evt_01J...",
  "type": "invoice.paid",
  "createdAt": "2026-10-24T10:00:00.000Z",
  "data": { "invoiceId": "inv_123", "amount": 4900 }
}
```

### Signing

```text
signed_content = "{Hookline-Timestamp}.{raw request body}"
signature      = HMAC_SHA256(endpoint_secret, signed_content)  → hex
header         = "v1=" + signature
```

The secret is the `whsec_...` value. During a rotation grace window the header contains one `v1=` value per valid secret.

### Verification (Node example)

```js
import crypto from 'node:crypto';

export function verify(rawBody, headers, secret, toleranceSec = 300) {
  const ts = headers['hookline-timestamp'];
  if (Math.abs(Date.now() / 1000 - Number(ts)) > toleranceSec) return false;

  const expected = crypto.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');

  return headers['hookline-signature'].split(' ').some((part) => {
    const sig = part.replace(/^v1=/, '');
    return (
      sig.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    );
  });
}
```

Verify against the **raw** body, not a re-serialized one.

### Response semantics

- Any `2xx` is success. Respond quickly and process asynchronously.
- Everything else is failure: non-2xx, timeout (default 10 s), connection or TLS error. Redirects are **not** followed and count as failure.
- Failures retry per the schedule in ARCHITECTURE.md.
- Delivery is **at-least-once**, so dedupe on `Hookline-Delivery-Id`.
