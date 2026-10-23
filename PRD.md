# Hookline: Product Requirements Document

**Version:** 0.1
**Last updated:** 2026-10-24
**Status:** Draft, approved for build

---

## 1. Overview

Hookline is a multi-tenant webhook delivery platform. Customers (SaaS developers) send events to Hookline through a REST API. Hookline reliably delivers those events to the HTTP endpoints their own users have registered, and provides a dashboard to inspect, debug, and replay deliveries.

## 2. Problem statement

Sending webhooks reliably is harder than it looks. Teams repeatedly rebuild the same pieces: retry queues, signature schemes, timeouts, backoff, failure isolation, delivery logs, and replay tooling. Most home-grown versions lose events during deploys, hammer broken endpoints, and give support teams no visibility into what happened.

## 3. Goals

1. Deliver every accepted event to every subscribed endpoint at least once, surviving crashes and deploys.
2. Make failures visible and recoverable: full attempt history and replay.
3. Protect both sides: customers' endpoints (rate limits, circuit breaker) and the platform (SSRF protection, quotas).
4. Be horizontally scalable, with stateless API and worker replicas.
5. Be observable by default: metrics, traces, and structured logs.
6. Serve as a portfolio-grade reference for infra-heavy full-stack engineering.

## 4. Non-goals (v1)

- Billing, plans, or payment integration
- Inbound webhook receiving or transformation
- Event schema registry or versioned payload transformation
- Multi-region deployment
- Customer-facing embeddable portal
- Kafka or any second queue system
- Mobile apps

## 5. Personas

| Persona                       | Description                                                     | Primary needs                                                         |
| ----------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| **Integrator (developer)**    | Backend developer at a SaaS company using the Hookline REST API | Simple ingestion API, clear docs, signature verification, idempotency |
| **Operator (dashboard user)** | Engineer or support person who monitors deliveries              | Live logs, search, failure inspection, replay                         |
| **Org admin**                 | Manages organization, members, API keys                         | Roles, key management, audit trail                                    |

## 6. User stories

- As an integrator, I send one event and it reaches all subscribed endpoints.
- As an integrator, I retry my own `POST /v1/events` call safely using an idempotency key.
- As an integrator, I verify a Hookline signature on my receiving server in a few lines of code.
- As an operator, I see deliveries appear and change status live, without refreshing.
- As an operator, I inspect the exact request and response of any attempt.
- As an operator, I replay one delivery, or all failed deliveries for an endpoint, after fixing a bug.
- As an operator, I see when an endpoint is auto-paused by the circuit breaker and why.
- As an admin, I create, scope, and revoke API keys, and rotate an endpoint secret without downtime.
- As an admin, I invite members and assign roles.

## 7. Functional requirements

### 7.1 Authentication and tenancy

- **FR-1** Users sign up and sign in with email and password (Better Auth). Optional 2FA is a stretch goal.
- **FR-2** Resources belong to an organization. Users can belong to multiple organizations and switch the active one.
- **FR-3** Roles: `owner`, `admin`, `member`. Role requirements per operation are in API.md.
- **FR-4** The public API authenticates with hashed API keys scoped to one organization.
- **FR-5** Every data query is scoped by `organization_id`. Cross-tenant access is impossible by construction.

### 7.2 Endpoints

- **FR-6** Create, list, read, update, and soft-delete endpoints (URL, description, event-type filter, timeout, max attempts, outbound rate limit).
- **FR-7** Each endpoint has a signing secret, shown on creation and rotation.
- **FR-8** Secret rotation keeps the old secret valid for a configurable grace window (default 24h). During it, both signatures are sent.
- **FR-9** Endpoints can be enabled or disabled manually.
- **FR-10** Endpoint URLs are validated: HTTPS required in production, private and internal addresses blocked (SSRF protection).
- **FR-11** A test action sends a sample event synchronously and returns the result.

### 7.3 Event ingestion

- **FR-12** `POST /v1/events` accepts `type` and `payload`, returns `202 Accepted`, and persists before acknowledging.
- **FR-13** Fan-out: one delivery is created for each active endpoint whose filter matches the event type.
- **FR-14** `Idempotency-Key` makes ingestion safe to retry. The same key and payload return the original result. The same key with a different payload is rejected.
- **FR-15** Payload size limit: 256 KB. Event type format is validated.
- **FR-16** Ingestion is rate limited per API key.

### 7.4 Delivery engine

- **FR-17** Each delivery is attempted by a worker with a per-endpoint timeout.
- **FR-18** Success means any `2xx` response. Redirects are not followed and count as failure.
- **FR-19** Failures (non-2xx, timeout, network or TLS error) retry on the schedule in ARCHITECTURE.md, with jitter, up to `max_attempts`.
- **FR-20** After exhausting attempts, the delivery becomes `dead` and stays replayable.
- **FR-21** Every attempt is persisted with request headers, response status, headers, truncated body, error, and duration.
- **FR-22** Payloads are signed with HMAC-SHA256 and include a timestamp (see API.md).
- **FR-23** Per-endpoint circuit breaker: opens after sustained failures, probes after a cool-down, and closes on success. Sustained open state auto-disables the endpoint.
- **FR-24** Per-endpoint outbound rate limiting. Rate-limited jobs are delayed without consuming an attempt.
- **FR-25** A reconciler recovers deliveries that were persisted but never enqueued.
- **FR-26** Graceful shutdown: in-flight deliveries finish or are safely returned to the queue.

### 7.5 Replay

- **FR-27** Replay a single delivery (creates a new linked delivery).
- **FR-28** Replay all events for an endpoint, or all `dead`/`failed` deliveries matching a filter (bulk).

### 7.6 Dashboard

- **FR-29** Pages: Overview, Endpoints (list and detail), Events (list and detail), Deliveries (list and detail with attempt timeline), API Keys, Settings, Members.
- **FR-30** The live log updates in real time over WebSocket, scoped to the active organization.
- **FR-31** Filtering and searching by status, endpoint, event type, and time range. Cursor pagination.
- **FR-32** Analytics: volume, success rate, latency percentiles, and per-endpoint health over time (Recharts).
- **FR-33** On WebSocket reconnect, the UI backfills missed updates.

### 7.7 Operations

- **FR-34** Liveness and readiness endpoints.
- **FR-35** Prometheus `/metrics`, OpenTelemetry traces across API, queue, and worker, and Grafana dashboards provisioned as code.
- **FR-36** Scheduled maintenance jobs: stats rollups, retention cleanup, reconciler, secret-rotation expiry, circuit probes.
- **FR-37** Audit log of security-relevant actions.

## 8. Non-functional requirements

Targets are validated with k6 load tests in Phase 13/15.

| Category               | Requirement                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| **Durability**         | No acknowledged event is lost on process crash, container kill, or deploy                |
| **Delivery semantics** | At-least-once. Duplicates are possible, so consumers dedupe using `Hookline-Delivery-Id` |
| **Ingestion latency**  | p99 under 100 ms server-side at 500 events/s per API replica                             |
| **Dispatch lag**       | p95 from ingestion to first attempt under 1 s at normal load                             |
| **Scalability**        | API and worker replicas scale independently. No instance holds unique state              |
| **Availability**       | Rolling restarts with zero lost deliveries                                               |
| **Security**           | See section 9                                                                            |
| **Observability**      | Every request and attempt is traceable by ID across API, queue, and worker               |
| **Maintainability**    | Module boundaries enforced by lint rules. Docs updated alongside code                    |

## 9. Security requirements

- Passwords and sessions handled by Better Auth. Cookies are `HttpOnly`, `Secure`, `SameSite`.
- API keys: random, high-entropy, shown once, stored only as hash.
- Endpoint secrets: encrypted at rest (AES-256-GCM).
- SSRF protection on endpoint URLs and at connect time (DNS resolution check, blocked ranges, no redirects).
- Only the `worker` role makes outbound HTTP to customer URLs.
- Strict input validation (Zod) on every boundary.
- Per-tenant isolation on every query. Optional Postgres RLS hardening.
- Secrets never appear in logs.
- Audit log for key creation and revocation, secret rotation, member changes, and endpoint changes.

## 10. Success metrics

- Chaos test: killing any single worker or API container during a 10-minute load run loses 0 events.
- 100% of attempts are visible in the dashboard with full request and response detail.
- Replay of 1,000 dead deliveries completes without manual intervention.
- Load test reports are published in the README (events/s, p99 latencies).
- All phases in PHASES.md complete, with CI green.

## 11. Constraints and assumptions

- Single region, single Postgres, single Redis for v1 (HA is documented, not built).
- Redis is configured with AOF persistence in the demo topology so queued jobs survive a Redis restart.
- Postgres is the source of truth. Redis state is reconstructable or non-critical.
- The team (one developer plus AI agents) builds this phase by phase.

## 12. Risks and mitigations

| Risk                                              | Mitigation                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| Event persisted but job never enqueued            | Reconciler job re-enqueues stale `pending` deliveries                  |
| Duplicate deliveries from at-least-once semantics | Deterministic delivery IDs sent in headers, documented consumer dedupe |
| SSRF via customer URLs                            | URL validation, DNS and IP checks at connect time, worker-only egress  |
| Retry storms against a failing endpoint           | Circuit breaker, rate limits, jittered backoff                         |
| Scope creep from three protocols                  | Thin protocol layers over shared services, strict phasing              |
| Redis loss                                        | AOF persistence, reconciler, Postgres as source of truth               |
| WebSocket instability during deploys              | Heartbeats, client backoff reconnect, backfill queries                 |

## 13. Glossary

| Term                | Meaning                                             |
| ------------------- | --------------------------------------------------- |
| **Event**           | A message the integrator sends (`type` + `payload`) |
| **Endpoint**        | A customer URL that receives events                 |
| **Delivery**        | One event to one endpoint, with lifecycle state     |
| **Attempt**         | One HTTP request made for a delivery                |
| **Replay**          | Creating a fresh delivery from an existing one      |
| **Dead**            | A delivery that exhausted all attempts              |
| **Circuit breaker** | Mechanism that pauses traffic to a failing endpoint |
