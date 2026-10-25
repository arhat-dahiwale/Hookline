# Hookline: Architecture

---

## 1. Principles

1. **Postgres is the source of truth.** Redis holds queues, caches, counters, and pub/sub. It can be rebuilt from Postgres, apart from in-flight job timing.
2. **Stateless app servers.** Any API or worker instance can be killed or added at any time.
3. **Modular monolith.** Strong module boundaries now, cheap extraction later.
4. **Protocols are thin.** REST, tRPC, gRPC, and WebSocket handlers contain no business logic. They call module services.
5. **At-least-once, idempotently.** Duplicates are possible, so everything is designed to tolerate them.
6. **Egress isolation.** Only the worker role makes outbound requests to customer URLs.
7. **Observable by default.** Every request, job, and attempt carries trace and request IDs.

## 2. System overview

```text
   Integrator backends                         Dashboard (browser)
          │  REST /v1/*                          │  tRPC /trpc/*   WS /ws   Better Auth /api/auth/*
          ▼                                      ▼
   ┌──────────────────────────── nginx ────────────────────────────┐
   └────────────┬──────────────────────────────────┬───────────────┘
                ▼                                  ▼
        ┌───────────────┐                  ┌───────────────┐
        │ api replica 1 │       ...        │ api replica N │      ROLE=api
        └──┬─────┬──┬───┘                  └───────────────┘
           │     │  └─── gRPC ───────────────┐
           │     │ SQL                       ▼
           │     ▼                    ┌───────────────┐
           │  ┌────────────┐          │ worker 1..M   │          ROLE=worker
           │  │ PostgreSQL │◄─────────┤ BullMQ procs  │──► HTTPS ──► customer endpoints
           │  └────────────┘   SQL    │ gRPC server   │
           │                          └───────┬───────┘
           │ enqueue / subscribe              │ publish / consume
           ▼                                  ▼
        ┌───────────────────── Redis ──────────────────────┐
        │ BullMQ queues · rate limits · breaker · pub/sub  │
        └──────────────────────────────────────────────────┘

   Observability: all roles ──OTLP──► OTel Collector ──► Tempo/Jaeger
                  all roles ──/metrics──► Prometheus ──► Grafana
```

## 3. Runtime roles

One image, selected with the `ROLE` environment variable.

| Role     | Loads                                                                                      | Purpose                                      |
| -------- | ------------------------------------------------------------------------------------------ | -------------------------------------------- |
| `api`    | REST, tRPC, WebSocket gateway, Better Auth routes, Redis pub/sub subscriber, gRPC _client_ | Serves all inbound traffic and enqueues jobs |
| `worker` | BullMQ processors, maintenance schedulers, gRPC _server_, Redis publisher                  | Delivers webhooks, runs maintenance          |
| `all`    | Everything, with in-process adapters instead of gRPC                                       | Local development                            |

Scale each role independently. API load follows ingestion and dashboard traffic. Worker load follows delivery volume and customer endpoint latency.

## 4. Modules

Located in `apps/server/src/modules/`. Each module exposes a public service interface through its `index.ts`. **Other modules may import only from that file.** Boundaries are enforced with lint rules (`eslint-plugin-boundaries` or `dependency-cruiser`).

| Module            | Responsibility                                                             | Owns tables                       | May depend on                                            |
| ----------------- | -------------------------------------------------------------------------- | --------------------------------- | -------------------------------------------------------- |
| `auth`            | Better Auth wiring, session resolution, guards                             | Better Auth tables                | platform                                                 |
| `api-keys`        | Create, hash, verify, scope API keys                                       | `api_keys`                        | platform, audit                                          |
| `endpoints`       | Endpoint CRUD, secrets, URL validation, health state                       | `endpoints`, `endpoint_health`    | platform, audit                                          |
| `events`          | Ingestion, idempotency, fan-out orchestration                              | `events`                          | endpoints, deliveries, delivery-queue, platform          |
| `deliveries`      | Delivery lifecycle, attempts, replay logic                                 | `deliveries`, `delivery_attempts` | endpoints, platform                                      |
| `delivery-queue`  | BullMQ delivery queue (enqueue side), retry schedule and backoff           | none                              | platform                                                 |
| `delivery-engine` | BullMQ processors, signing, HTTP client, breaker, rate limiter, reconciler | none (uses services)              | delivery-queue, deliveries, endpoints, platform          |
| `realtime`        | WebSocket gateway, Redis pub/sub bridge                                    | none                              | auth, platform                                           |
| `analytics`       | Rollups, stats queries                                                     | `delivery_stats_hourly`           | platform (reads via own queries)                         |
| `audit`           | Audit log writer and reader                                                | `audit_logs`                      | platform                                                 |
| `settings`        | Org-level preferences (retention override)                                 | `org_settings`                    | audit, platform                                          |
| `trpc`            | tRPC protocol layer for the dashboard (context, role middleware, routers)  | none (uses services)              | auth, endpoints, deliveries, delivery-engine, platform   |
| `worker-ops`      | WorkerOperationsService adapters: in-process (worker/all) and gRPC (api)   | none (uses services)              | delivery-engine, deliveries, events, endpoints, platform |
| `health`          | Liveness and readiness                                                     | none                              | platform                                                 |
| `platform`        | Config, logger, DB, Redis, telemetry, unit-of-work, errors                 | none                              | none                                                     |

**Rules**

- A module reads or writes only its own tables. Everything else goes through another module's service.
- Cross-module transactions use the `UnitOfWork` abstraction from `platform`, which passes a transaction handle. This is the only sanctioned way to share a transaction.
- Cross-module reactions that don't need a return value use the in-process event bus (see section 7.4).

### Protocol layers

```text
REST controllers ─┐
tRPC routers ─────┼──► module services (business logic) ──► repositories ──► Postgres
gRPC handlers ────┤
WS gateway ───────┘
```

Controllers, routers, and handlers do three things only: authenticate and authorize, validate input (Zod), and call a service.

## 5. Key flows

### 5.1 Event ingestion

1. Client calls `POST /v1/events` through nginx to any API replica.
2. `ApiKeyGuard` resolves the organization (Redis cache, Postgres fallback) and the rate limiter checks the key's bucket.
3. Zod validates the body (type format, 256 KB cap).
4. Idempotency check: Redis fast path, Postgres unique constraint as the source of truth.
5. In **one transaction**: insert the event, find matching active endpoints, and insert one `pending` delivery per endpoint.
6. After commit: enqueue one `delivery` job per delivery (`jobId = {deliveryId}.{attempt}` — BullMQ reserves `:` in custom job ids, so the documented `: ` convention maps to `.`).
7. Return `202` with the event and delivery IDs.

If the process dies between steps 5 and 6, the **reconciler** finds `pending` deliveries older than the grace period with no live job and enqueues them.

### 5.2 Delivery attempt

1. Worker picks up the job and loads the delivery, endpoint (decrypts secret), and event.
2. Checks: endpoint still active? Circuit open? Outbound rate limit available? If the breaker is open or the limit is hit, the job is re-delayed **without consuming an attempt**.
3. Builds the envelope, signs `{timestamp}.{rawBody}` with HMAC-SHA256 (both secrets during a rotation window), and sends the HTTP request (timeout, no redirects, SSRF-checked connect).
4. Persists a `delivery_attempts` row and updates the delivery.
5. On `2xx`: the delivery becomes `succeeded` and the breaker records success.
6. On failure: the breaker records failure. If attempts remain, status becomes `retrying`, and BullMQ re-runs the job with the custom backoff delay. Otherwise the status becomes `dead`.
7. The worker publishes `delivery.attempt.completed` and `delivery.status.changed` to Redis pub/sub.

### 5.3 Live updates

1. Browser connects to `/ws` through nginx. The handshake is authenticated with the Better Auth session cookie.
2. The gateway registers the socket under its organization and subscriptions.
3. Each API instance subscribes to Redis channel `hl:org:{orgId}` for organizations it has local sockets for.
4. Workers publish messages. Every API instance forwards them to its local matching sockets.
5. On reconnect, the client backfills through a tRPC query using its last-seen timestamp.

### 5.4 Replay and test

- **Replay delivery/event:** the API calls the worker role's `ReplayDelivery` / `ReplayEvent` (gRPC when split, in-process otherwise). A new delivery linked via `replay_of_delivery_id` is created and enqueued at high priority.
- **Test endpoint:** the API calls `TestEndpoint` on the worker role, which makes the outbound request synchronously and returns the result. The API never contacts customer URLs itself.

## 6. Reliability design

### 6.1 Delivery semantics

At-least-once. Every request carries `Hookline-Delivery-Id`, which is stable across retries of the same delivery. Consumers dedupe on it.

### 6.2 Retry schedule

| Attempt | Delay before attempt |
| ------- | -------------------- |
| 1       | immediate            |
| 2       | 5 s                  |
| 3       | 30 s                 |
| 4       | 2 min                |
| 5       | 10 min               |
| 6       | 1 h                  |
| 7       | 6 h                  |
| 8       | 24 h                 |

Jitter of ±20% is applied. The default is `max_attempts = 8` (about 31 hours in total) and is configurable per endpoint. After the last attempt, the delivery becomes `dead` and stays replayable.

### 6.3 Circuit breaker (per endpoint)

| State         | Behavior                                                    | Transition                                                                                 |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **closed**    | Normal traffic                                              | Opens after 10 consecutive failures, or more than 50% failures across the last 20 attempts |
| **open**      | No attempts. Jobs are re-delayed without consuming attempts | After a 60 s cool-down (doubling up to 15 min), moves to half-open                         |
| **half-open** | One probe attempt allowed                                   | Probe success closes the breaker. Probe failure reopens it with a longer cool-down         |

If a breaker stays open continuously for 24 h, the endpoint is **auto-disabled** (`disabled_reason = circuit_breaker`), an audit entry is written, and the dashboard shows a banner. Live state is in Redis (`cb:{endpointId}`), with a snapshot written to `endpoint_health`.

### 6.4 Idempotency

- **Ingestion:** `Idempotency-Key` (Redis fast path, Postgres unique constraint authoritative).
- **Attempts:** unique `(delivery_id, attempt_number)`. Job execution first claims the attempt number. A duplicate run detects the existing row and exits without sending.

### 6.5 Reconciler

A maintenance job runs every 30 s. It finds deliveries in `pending` or `retrying` whose job is missing from BullMQ, or whose `next_attempt_at` is overdue by more than the grace period, and re-enqueues them. This heals Redis data loss and the "committed but never enqueued" gap.

### 6.6 Graceful shutdown

On `SIGTERM`: stop accepting HTTP and WebSocket connections (API) or stop fetching new jobs (worker), wait for in-flight work up to `SHUTDOWN_TIMEOUT_MS`, close sockets with code `1001`, flush telemetry, then close DB and Redis. Jobs that don't finish are returned to the queue by BullMQ's stalled-job handling.

### 6.7 Rate limiting

- **Ingestion:** Redis token bucket per API key (Lua script). Returns `429` with `RateLimit-*` headers.
- **Outbound:** Redis token bucket per endpoint. A limited job is delayed by the time until the next token, without consuming an attempt.
- **nginx:** coarse `limit_req` as a first layer only.

## 7. Cross-cutting concerns

### 7.1 Statelessness map

| State                                       | Location                                                       |
| ------------------------------------------- | -------------------------------------------------------------- |
| Sessions                                    | Postgres (Better Auth), session cookie                         |
| Jobs, retries, schedules                    | BullMQ in Redis (reconstructable from Postgres via reconciler) |
| Breaker, rate limits, idempotency fast path | Redis                                                          |
| Scheduled jobs                              | BullMQ job schedulers (single firing, even with many workers)  |
| WebSocket connections                       | Local to an instance. Fan-out via Redis pub/sub                |
| Everything durable                          | Postgres                                                       |

### 7.2 Security

- **SSRF:** URL validated at creation. At connect time the worker resolves DNS, rejects private, loopback, link-local, and metadata ranges (IPv4 and IPv6), and connects to the validated IP. Redirects are never followed. A dev-only flag can allow localhost.
- **Secrets:** endpoint secrets are encrypted with AES-256-GCM (`ENCRYPTION_KEY`, with a key-ID prefix to allow future rotation). API keys are stored as SHA-256 hashes with a lookup prefix.
- **Signatures:** `v1=HMAC_SHA256(secret, "{timestamp}.{body}")` with a 5-minute recommended tolerance on the receiver side.
- **Authorization:** role checks in guards and middleware. Every query is scoped by organization. Optional Postgres RLS later.
- **Input:** Zod on every boundary. Payload size capped at the Fastify body limit and in the schema.

### 7.3 Observability

**Metrics** (Prometheus, avoiding high-cardinality labels such as org or endpoint IDs):

| Metric                                                        | Type      |
| ------------------------------------------------------------- | --------- |
| `hookline_http_request_duration_seconds{route,method,status}` | histogram |
| `hookline_events_ingested_total`                              | counter   |
| `hookline_deliveries_created_total`                           | counter   |
| `hookline_delivery_attempts_total{outcome}`                   | counter   |
| `hookline_delivery_attempt_duration_seconds`                  | histogram |
| `hookline_delivery_dispatch_lag_seconds`                      | histogram |
| `hookline_deliveries_dead_total`                              | counter   |
| `hookline_queue_depth{queue,state}`                           | gauge     |
| `hookline_circuit_breaker_transitions_total{to}`              | counter   |
| `hookline_rate_limited_total{scope}`                          | counter   |
| `hookline_ws_connections`                                     | gauge     |
| Node.js default process metrics                               | various   |

**Traces** (OpenTelemetry): one trace spans API request, DB queries, enqueue, the worker job, and the outbound HTTP call. Trace context travels in job data.

**Logs** (Pino): JSON, with `requestId`, `traceId`, `organizationId`, and `deliveryId` where relevant. Secrets are redacted.

**Dashboards** (Grafana, provisioned as code): API overview, Delivery engine, Queues, Infrastructure (Postgres and Redis exporters).

### 7.4 In-process event bus

NestJS event emitter, used for same-process reactions (for example, `delivery.attempt.completed` triggers the Redis publisher and the breaker update). It is **not** a delivery mechanism. Anything that must survive a crash goes through Postgres or BullMQ.

## 8. Deployment topology (demo)

| Service                           | Replicas     | Notes                             |
| --------------------------------- | ------------ | --------------------------------- |
| nginx                             | 1            | Public entry, port 8080           |
| api                               | 3            | `ROLE=api`, scaled with `--scale` |
| worker                            | 2            | `ROLE=worker`                     |
| web                               | 1            | Next.js (behind nginx)            |
| postgres                          | 1            | Volume-backed                     |
| redis                             | 1            | AOF persistence on                |
| migrate                           | 1 (one-shot) | Runs migrations before app start  |
| otel-collector, tempo/jaeger      | 1            | Traces                            |
| prometheus, grafana               | 1            | Metrics and dashboards            |
| postgres-exporter, redis-exporter | 1            | Infra metrics                     |

### nginx essentials

```nginx
resolver 127.0.0.11 valid=5s;   # Docker DNS: re-resolve so scaled/killed replicas are picked up

server {
  listen 80;
  set $api_upstream http://api:4000;

  location /v1/ { proxy_pass $api_upstream; }
  location /trpc/ { proxy_pass $api_upstream; }
  location /api/auth/ { proxy_pass $api_upstream; }

  location /ws {
    proxy_pass $api_upstream;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 1h;
  }

  location / { proxy_pass http://web:3000; }   # Next.js
}
```

## 9. Configuration

All config is validated with Zod at startup. The app refuses to boot on invalid config.

| Variable                                | Purpose                                                       |
| --------------------------------------- | ------------------------------------------------------------- |
| `ROLE`                                  | `api` / `worker` / `all`                                      |
| `NODE_ENV`, `PORT`, `LOG_LEVEL`         | Basics                                                        |
| `DATABASE_URL`                          | Postgres                                                      |
| `REDIS_URL`                             | Redis                                                         |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Auth                                                          |
| `AUTH_TRUSTED_ORIGINS`                  | Dashboard origins trusted for Better Auth CSRF checks         |
| `NEXT_PUBLIC_WS_URL`                    | Browser-facing WebSocket URL (default ws://localhost:4000/ws) |
| `ENCRYPTION_KEY`                        | AES-256-GCM key for endpoint secrets (32 bytes, base64)       |
| `INTERNAL_GRPC_TOKEN`                   | Shared token for API→worker gRPC                              |
| `WORKER_GRPC_URL`                       | Address of the worker gRPC server                             |
| `OTEL_EXPORTER_OTLP_ENDPOINT`           | Telemetry export                                              |
| `ALLOW_INSECURE_ENDPOINTS`              | Dev only: allow http/localhost endpoint URLs                  |
| `SHUTDOWN_TIMEOUT_MS`                   | Graceful shutdown budget                                      |
| `DELIVERY_CONCURRENCY`                  | Jobs processed concurrently per worker                        |

## 10. Architecture decisions

| #   | Decision                                               | Rationale                                                         | Alternatives considered                                   |
| --- | ------------------------------------------------------ | ----------------------------------------------------------------- | --------------------------------------------------------- |
| 1   | Modular monolith with roles                            | Independent scaling without microservice overhead                 | Separate services from day one                            |
| 2   | BullMQ over Kafka                                      | Redis already present. Retries, delays, and rate limits built in  | Kafka (heavier, only valuable for replayable streams)     |
| 3   | Postgres as source of truth, reconciler for Redis gaps | Avoids dual-write loss without a full outbox                      | Transactional outbox table (possible later)               |
| 4   | tRPC for the dashboard                                 | End-to-end types, reuses Nest services                            | REST for everything                                       |
| 5   | gRPC only at the real role boundary                    | Synchronous, streaming, and typed internal calls                  | gRPC between in-process modules (rejected: pure overhead) |
| 6   | WebSocket + Redis pub/sub                              | Bidirectional channel, instance-independent fan-out               | SSE (simpler, one-way)                                    |
| 7   | Better Auth                                            | Framework-agnostic, org and 2FA plugins, sessions in our Postgres | Passport JWT (too low-level), Auth.js                     |
| 8   | Custom API key module                                  | Hot path needs a cached, hash-only lookup                         | Better Auth API-key plugin                                |
| 9   | Drizzle ORM                                            | Thin, SQL-close, strong typing, easy migrations                   | Prisma                                                    |
| 10  | `ws` library for WebSockets                            | Lightweight, works with Fastify and Nest                          | Socket.IO (more features, more overhead)                  |
| 11  | Prefixed ULIDs as IDs                                  | Sortable, readable in logs                                        | UUIDv4, bigserial                                         |

## 11. Extraction path (modular monolith to services)

1. Pick a module with a clean boundary (for example `delivery-engine`, `analytics`).
2. Define its interface as a `.proto` (already done for the worker role).
3. Provide a gRPC adapter implementing the same TypeScript interface callers already use.
4. Run it as its own deployable using the same image or a trimmed one.
5. Give it its own database schema or database. No other module may touch its tables, so this is already true.
