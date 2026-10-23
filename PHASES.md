# Hookline: Build Phases

Mark tasks `[x]` when **done and verified** (code, tests, and docs updated). Work phases in order. Do not start a phase until the previous phase's exit criteria are met, unless the human says otherwise.

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done

## Progress overview

| Phase | Name | Status |
|---|---|---|
| 0 | Repo foundation | [ ] |
| 1 | Local infra & server skeleton | [ ] |
| 2 | Auth & multi-tenancy | [ ] |
| 3 | Domain schema & API keys | [ ] |
| 4 | Public REST API | [ ] |
| 5 | Delivery engine | [ ] |
| 6 | Resilience | [ ] |
| 7 | tRPC & dashboard foundation | [ ] |
| 8 | Dashboard features | [ ] |
| 9 | Real-time (WebSocket) | [ ] |
| 10 | Internal gRPC | [ ] |
| 11 | Analytics | [ ] |
| 12 | Observability | [ ] |
| 13 | Scale topology & chaos demo | [ ] |
| 14 | Testing & CI/CD hardening | [ ] |
| 15 | Docs, polish & launch | [ ] |

> Tests are written **within each phase**. Phase 14 is for gaps, hardening, and CI polish, not for "adding tests later".

---

## Phase 0: Repo foundation
**Goal:** a clean, buildable monorepo skeleton.
**Exit criteria:** `pnpm install && pnpm build && pnpm lint && pnpm typecheck` all pass on an empty skeleton.

- [ ] Initialize git repo, `.gitignore`, `.editorconfig`, `.nvmrc`
- [x] Add the eight root docs (README, PRD, PHASES, ARCHITECTURE, DATA, API, AGENTS, LOGS)
- [ ] Set up pnpm workspace and Turborepo (`pnpm-workspace.yaml`, `turbo.json`)
- [ ] Create skeletons: `apps/web`, `apps/server`, `packages/shared`, `packages/proto`, `packages/config`
- [ ] Shared strict TypeScript base config
- [ ] ESLint and Prettier configs, with import-boundary rules scaffolded
- [ ] Husky + lint-staged + commitlint (Conventional Commits)
- [ ] Root scripts: `dev`, `build`, `lint`, `typecheck`, `test`
- [ ] `.env.example` with documented variables

## Phase 1: Local infra & server skeleton
**Goal:** a running NestJS + Fastify server with config, logging, and health.
**Exit criteria:** `GET /health/ready` returns 200 only when Postgres and Redis are reachable.

- [ ] `docker-compose.dev.yml` with Postgres and Redis (healthchecks, named volumes, Redis AOF on)
- [ ] Zod-validated config module (fail fast on invalid env)
- [ ] NestJS bootstrap with Fastify adapter
- [ ] `ROLE` switch (`api`, `worker`, `all`) controlling which modules load
- [ ] Pino logger with request ID propagation
- [ ] Standard error format and global exception filter
- [ ] Health module: `/health/live`, `/health/ready`
- [ ] Platform module: DB (Drizzle) and Redis client providers
- [ ] Graceful shutdown hooks skeleton
- [ ] Multi-stage Dockerfile for the server image
- [ ] Unit tests for config and error filter

## Phase 2: Auth & multi-tenancy
**Goal:** users can sign up, sign in, and work inside organizations.
**Exit criteria:** two users in separate orgs cannot see each other's data (tested).

- [ ] Drizzle migration tooling (`db:generate`, `db:migrate`)
- [ ] Install Better Auth and generate its schema (organization plugin enabled)
- [ ] NestJS integration (raw body handling, mounted at `/api/auth/*`)
- [ ] Email/password sign-up and sign-in
- [ ] Organization create/switch, member roles (`owner`, `admin`, `member`)
- [ ] Shared `resolveSession()` function (used by tRPC context and WebSocket handshake)
- [ ] `SessionGuard` and `RolesGuard`
- [ ] Tenant-scoping helper enforcing `organization_id` on queries
- [ ] Integration tests: auth flows, cross-tenant isolation
- [ ] (Stretch) 2FA plugin

## Phase 3: Domain schema & API keys
**Goal:** all core tables exist and API key auth works.
**Exit criteria:** a request with a valid API key resolves its organization. Revoked or invalid keys are rejected.

- [ ] Migrations for `endpoints`, `endpoint_health`, `events`, `deliveries`, `delivery_attempts`, `api_keys`, `audit_logs`, `delivery_stats_hourly`
- [ ] Enums and indexes exactly as specified in DATA.md
- [ ] Repository layer per module (no cross-module table access)
- [ ] ID generation helpers (prefixed ULIDs)
- [ ] API key generation, hashing, and Redis-cached lookup
- [ ] `ApiKeyGuard` with scope checks and `last_used_at` throttled updates
- [ ] AES-256-GCM encryption helper for endpoint secrets
- [ ] Audit module with write helper
- [ ] Seed script (demo org, user, endpoints)
- [ ] Integration tests for API key lifecycle

## Phase 4: Public REST API
**Goal:** the full public API from API.md section 1, documented via OpenAPI.
**Exit criteria:** an integrator can create an endpoint and send an event, and the delivery rows exist (not yet delivered).

- [ ] Zod-to-OpenAPI integration, Swagger UI at `/docs`, spec at `/openapi.json`
- [ ] Endpoints CRUD, enable/disable, rotate-secret
- [ ] SSRF-safe URL validator (shared by REST and tRPC)
- [ ] `POST /v1/events` with validation, size limit, and event-type format
- [ ] Idempotency-Key handling (Postgres unique + Redis fast path)
- [ ] Transactional fan-out: event + delivery rows in one transaction
- [ ] Event and delivery read endpoints with cursor pagination
- [ ] Ingestion rate limiting (Redis token bucket) with `RateLimit-*` headers
- [ ] Consistent error codes per API.md
- [ ] Integration and contract tests for every route

## Phase 5: Delivery engine
**Goal:** deliveries are actually sent, signed, retried, and recorded.
**Exit criteria:** an event sent via REST reaches a test receiver with a valid signature. Failures retry on schedule.

- [ ] BullMQ setup: `delivery` and `maintenance` queues, shared Redis connection config
- [ ] Enqueue after commit (`jobId = deliveryId:attemptNumber`)
- [ ] Worker processor: load delivery, endpoint, and event, then send the HTTP request
- [ ] Payload envelope and HMAC-SHA256 signing (dual-signature during rotation)
- [ ] HTTP client: timeout, no redirects, response body truncation, DNS/IP SSRF check at connect time
- [ ] Persist every attempt (`delivery_attempts`) and update delivery state
- [ ] Custom backoff strategy with jitter (schedule in ARCHITECTURE.md)
- [ ] `dead` transition after max attempts
- [ ] Internal event bus emitting `delivery.attempt.completed` and `delivery.status.changed`
- [ ] Local test receiver app/script (configurable to fail, delay, or succeed)
- [ ] Integration tests with Testcontainers (Postgres + Redis) and the test receiver

## Phase 6: Resilience
**Goal:** the system survives failures gracefully.
**Exit criteria:** chaos test (kill worker mid-run) loses no deliveries, and a failing endpoint trips its breaker.

- [ ] Circuit breaker (Redis state, Postgres snapshot) with closed/open/half-open transitions
- [ ] Half-open probe job and recovery logic
- [ ] Auto-disable after sustained open state, plus audit entry
- [ ] Per-endpoint outbound rate limiter (delay without consuming an attempt)
- [ ] Reconciler job (re-enqueue stale `pending`/`retrying` deliveries without live jobs)
- [ ] Idempotent attempt handling (duplicate job execution is safe)
- [ ] Graceful shutdown: stop intake, drain in-flight, then exit (API and worker)
- [ ] Stalled-job handling configuration
- [ ] Maintenance schedulers registered via BullMQ job schedulers (single firing across replicas)
- [ ] Tests: breaker transitions, reconciler, shutdown behavior, duplicate-job safety

## Phase 7: tRPC & dashboard foundation
**Goal:** a logged-in dashboard shell with typed API access.
**Exit criteria:** a user signs in, switches org, and sees a placeholder overview loaded via tRPC.

- [ ] tRPC router mounted on the Fastify instance, reusing Nest services
- [ ] tRPC context (session, active org) and role-checking middleware
- [ ] Next.js app: layout, navigation, theming, shadcn/ui setup
- [ ] Better Auth client, sign-in/up pages, org switcher
- [ ] tRPC + TanStack Query client with error handling
- [ ] Zustand store for UI state
- [ ] Shared Zod schemas consumed from `packages/shared`
- [ ] Route protection middleware
- [ ] Tests for tRPC middleware and auth gating

## Phase 8: Dashboard features
**Goal:** operators can do everything through the UI.
**Exit criteria:** full endpoint, event, delivery, and key management without touching the API directly.

- [ ] Endpoints list and detail (create/edit form with Zod + React Hook Form)
- [ ] Secret reveal-once modal, rotate secret, enable/disable, test endpoint
- [ ] Events list (TanStack Table, filters, cursor pagination) and detail
- [ ] Deliveries list and detail with attempt timeline and request/response inspector
- [ ] Replay single delivery and bulk replay by filter
- [ ] API keys page: create (show once), scope selection, revoke
- [ ] Members and settings pages
- [ ] Empty, loading, and error states throughout
- [ ] Motion transitions for list changes and modals
- [ ] Component and E2E smoke tests (Playwright)

## Phase 9: Real-time (WebSocket)
**Goal:** the live delivery log.
**Exit criteria:** with 3 API replicas, a browser connected to any replica sees updates from deliveries executed by any worker.

- [ ] WebSocket gateway (`ws` via `@nestjs/platform-ws`) at `/ws`
- [ ] Handshake auth via Better Auth session, org-scoped subscriptions
- [ ] Worker publishes events to Redis pub/sub (`hl:org:{orgId}`)
- [ ] API instances subscribe and fan out to local sockets
- [ ] Server heartbeat and client ping/pong, dead-connection cleanup
- [ ] Message envelope and types per API.md
- [ ] Client hook: connect, reconnect with backoff and jitter, resubscribe
- [ ] Backfill on reconnect via tRPC query
- [ ] Live log UI with animated row updates and a pause/resume toggle
- [ ] Connection limits per user, plus metrics
- [ ] Tests: multi-instance fan-out, auth failures, reconnect backfill

## Phase 10: Internal gRPC
**Goal:** a real service boundary between API and worker roles.
**Exit criteria:** with `ROLE=api` and `ROLE=worker` as separate containers, replay and test-endpoint work through gRPC.

- [ ] `packages/proto`: `worker.proto` and codegen script (`pnpm proto:gen`)
- [ ] gRPC server on the worker role (`ReplayDelivery`, `ReplayEvent`, `TestEndpoint`, `GetEndpointHealth`)
- [ ] gRPC client in the API role behind the same TypeScript interface used in-process
- [ ] Config switch: in-process adapter when `ROLE=all`, gRPC adapter when split
- [ ] Internal auth via shared-token metadata (mTLS documented as future work)
- [ ] Deadlines, retries, and error mapping to API error codes
- [ ] `StreamDeliveryAttempts` server-streaming RPC (tail/debug)
- [ ] gRPC health checking protocol
- [ ] Tests for each RPC (in-process and over the wire)

## Phase 11: Analytics
**Goal:** useful charts and health summaries.
**Exit criteria:** Overview page shows accurate volume, success rate, and latency matching the raw data.

- [ ] Hourly rollup job writing `delivery_stats_hourly`
- [ ] Stats queries: overview, time series, per-endpoint breakdown, latency percentiles
- [ ] tRPC `stats.*` procedures
- [ ] Recharts: volume over time, success rate, latency p50/p95/p99, status breakdown
- [ ] Endpoint health panel (breaker state, recent failures, last success)
- [ ] Time-range selector and auto-refresh
- [ ] Retention cleanup job (events, attempts) in batches
- [ ] Tests: rollup correctness, query accuracy

## Phase 12: Observability
**Goal:** see inside the system.
**Exit criteria:** one trace spans API request, queue, worker attempt, and outbound HTTP. Grafana dashboards load from provisioning.

- [ ] OpenTelemetry SDK setup (traces, HTTP/Fastify, Postgres, Redis, BullMQ context propagation)
- [ ] Trace context carried in job data from API to worker
- [ ] Prometheus metrics endpoint with the metrics listed in ARCHITECTURE.md
- [ ] OTel Collector (and Tempo or Jaeger) in compose
- [ ] Prometheus config and scrape targets (API, workers, exporters)
- [ ] Postgres and Redis exporters
- [ ] Grafana provisioning: datasources and dashboards as code (API, Delivery Engine, Queues, Infra)
- [ ] Alert rules (dead deliveries, dispatch lag, queue depth)
- [ ] Log correlation (`traceId`, `requestId` in every log line)

## Phase 13: Scale topology & chaos demo
**Goal:** prove it scales and survives.
**Exit criteria:** the demo script in README runs end to end with zero lost events.

- [ ] nginx config: upstream via Docker DNS resolver, WebSocket upgrade, long timeouts, TLS option, coarse rate limit
- [ ] `docker-compose.yml` full topology (nginx, api x3, worker x2, postgres, redis, otel, prometheus, grafana)
- [ ] Container healthchecks and `depends_on` conditions
- [ ] Migration job container (runs once before app start)
- [ ] k6 load scripts (ingestion, mixed workloads)
- [ ] Chaos script: kill random api/worker containers during load, then verify counts
- [ ] Verification query/script: accepted events == terminal-state deliveries
- [ ] Record results and screenshots for README

## Phase 14: Testing & CI/CD hardening
**Goal:** confidence and automation.
**Exit criteria:** CI is green on a fresh clone, and coverage on core modules meets the targets in AGENTS.md.

- [ ] Coverage reports and thresholds for core modules (delivery engine, signing, breaker, idempotency)
- [ ] Contract tests: OpenAPI spec vs. implementation
- [ ] Playwright E2E for critical flows (sign-in, create endpoint, see live delivery, replay)
- [ ] GitHub Actions: lint, typecheck, unit, integration (Testcontainers), build
- [ ] Docker image build and push (tagged by commit and version)
- [ ] Dependency audit and Dependabot/Renovate
- [ ] Security checks: secret scanning, SSRF test suite, authorization matrix tests
- [ ] Flaky test triage

## Phase 15: Docs, polish & launch
**Goal:** make it presentable.
**Exit criteria:** a stranger can clone, run the demo, and understand the system in 15 minutes.

- [ ] README polish: screenshots, GIF of live log, benchmark results
- [ ] Verification code samples for customers (Node, Python, Go) in API.md
- [ ] Architecture diagrams finalized
- [ ] Seed/demo data and a one-command demo
- [ ] Accessibility and responsive pass on the dashboard
- [ ] Error-message and empty-state copy review
- [ ] Performance pass (indexes, slow-query review, bundle size)
- [ ] License and contributing guide
- [ ] Final docs consistency review (all eight files match the code)
- [ ] Tag `v1.0.0`