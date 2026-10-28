# Hookline

> Reliable webhook delivery infrastructure: signed payloads, smart retries, circuit breaking, live delivery logs, and one-click replay.

**Status:** Phase 0 (see [PHASES.md](./PHASES.md)). Commands below become available as phases are completed.

---

## What is Hookline?

Hookline lets a SaaS product send webhooks to its customers' servers without building the hard parts itself. You send one event to the Hookline API, and Hookline fans it out to every subscribed endpoint, signs it, delivers it, retries failures with exponential backoff, protects struggling endpoints with a circuit breaker, and shows every attempt in a real-time dashboard.

## Features

- **Reliable delivery**: at-least-once semantics, exponential backoff with jitter, dead-letter handling
- **Signed payloads**: HMAC-SHA256 signatures, replay-protection timestamps, zero-downtime secret rotation
- **Circuit breaker**: per-endpoint protection that stops hammering failing servers
- **Live delivery log**: WebSocket-powered dashboard with per-attempt request/response inspection
- **Replay**: re-send any event or delivery with one click, or in bulk
- **Idempotent ingestion**: safe client retries via `Idempotency-Key`
- **Multi-tenant**: organizations, members, roles, hashed API keys
- **Rate limiting**: per-API-key ingestion limits and per-endpoint outbound limits
- **Observability**: OpenTelemetry traces, Prometheus metrics, Grafana dashboards
- **Horizontally scalable**: stateless API and worker replicas behind nginx

## Architecture at a glance

```text
                 Customers' backends                    Dashboard users
                        │ REST                               │ tRPC + WebSocket
                        ▼                                    ▼
                  ┌───────────────── nginx ─────────────────┐
                  │            load balancer / TLS           │
                  └───────┬─────────────────────────┬───────┘
                          ▼                         ▼
                 ┌─────────────────┐       ┌─────────────────┐
                 │  api (xN)       │       │  api (xN)       │   ROLE=api
                 │  REST/tRPC/WS   │       │                 │
                 └───┬─────────┬───┘       └─────────────────┘
                     │ enqueue │ gRPC (replay, test, health)
                     ▼         ▼
              ┌──────────┐  ┌─────────────────┐
              │  Redis   │◄─┤ worker (xM)     │   ROLE=worker
              │ BullMQ   │  │ delivery engine │──► Customer endpoints
              │ pub/sub  │  └────────┬────────┘
              └──────────┘           ▼
                               ┌──────────┐
                               │ Postgres │
                               └──────────┘
```

Hookline is a **modular monolith**: one codebase and one Docker image, started with a `ROLE` (`api`, `worker`, or `all`). Details are in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Tech stack

| Area          | Technology                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend      | Next.js, React, TypeScript, Tailwind CSS, shadcn/ui + Radix, TanStack Query, TanStack Table, Zustand, Motion, React Hook Form, Zod, Recharts |
| Backend       | Node.js, NestJS + Fastify adapter, TypeScript, Zod                                                                                           |
| APIs          | REST + OpenAPI (public), tRPC (dashboard), gRPC + Protobuf (internal), WebSocket (live updates)                                              |
| Data          | PostgreSQL, Drizzle ORM, Redis                                                                                                               |
| Queue         | BullMQ                                                                                                                                       |
| Auth          | Better Auth (dashboard), custom hashed API keys (public API)                                                                                 |
| Observability | Pino, OpenTelemetry, Prometheus, Grafana                                                                                                     |
| Infra         | Docker, Docker Compose, nginx                                                                                                                |
| Tooling       | pnpm workspaces, Turborepo, Vitest/Jest, Supertest, Testcontainers, GitHub Actions                                                           |

## Repository structure

```text
hookline/
├── apps/
│   ├── web/                # Next.js dashboard
│   └── server/             # NestJS app (ROLE=api | worker | all)
├── packages/
│   ├── shared/             # Zod schemas, types, constants
│   ├── proto/              # .proto files + generated code
│   └── config/             # shared tsconfig / eslint / prettier
├── infra/
│   ├── docker/             # Dockerfiles
│   ├── nginx/              # nginx.conf
│   ├── prometheus/         # prometheus.yml
│   └── grafana/            # provisioning + dashboards
├── docker-compose.dev.yml  # postgres + redis for local dev
├── docker-compose.yml      # full demo topology
├── README.md  PRD.md  PHASES.md  ARCHITECTURE.md
├── DATA.md  API.md  AGENTS.md  LOGS.md
└── turbo.json  pnpm-workspace.yaml
```

## Getting started

### Prerequisites

- Node.js (current LTS, see `.nvmrc`)
- pnpm
- Docker + Docker Compose

### Setup

```bash
git clone <repo-url> hookline && cd hookline
pnpm install
cp .env.example .env            # then fill in secrets
docker compose -f docker-compose.dev.yml up -d   # postgres + redis
pnpm db:migrate
pnpm dev                        # API on :4000, dashboard on :3100
```

Then open the dashboard at **http://localhost:3100**. The web app reaches the
API through same-origin paths (`/trpc` and `/api/auth` are rewritten by
Next.js to `API_ORIGIN`, default `http://localhost:4000`), so session cookies
work without CORS. The live log connects its WebSocket directly to the API
(`NEXT_PUBLIC_WS_URL`, default `ws://localhost:4000/ws` — cookies are shared
across localhost ports). Port 3100 is used because 3000 is commonly taken; change
it via the `dev` script in `apps/web/package.json` and keep
`AUTH_TRUSTED_ORIGINS` in `.env` in sync (Better Auth rejects POSTs from
untrusted origins).

> Dev Postgres and Redis publish on host ports **15432** and **16379**
> (`POSTGRES_PORT` / `REDIS_PORT` in `.env`) to avoid conflicts with native
> services on 5432/6379. `DATABASE_URL` and `REDIS_URL` in `.env` already
> point there.

### Observability stack (Phase 12)

The collector, Tempo, Prometheus (with alert rules), Grafana and the
Postgres/Redis exporters are provisioned as code under `infra/`:

```bash
# Canonical stack (expects the Phase 13 compose network: api/worker/postgres/redis)
docker compose -f infra/docker-compose.observability.yml up -d

# Local verification against host processes + the dev compose (run once,
# verified 2026-10-25: Prometheus scraped api+worker, all 4 dashboards and
# both datasources provisioned in Grafana, traces reached Tempo)
HOOKLINE_PG_PASSWORD=<from .env> \
  docker compose -f infra/docker-compose.observability.yml \
                 -f infra/docker-compose.observability.local.yml up -d
```

Grafana lands at `http://localhost:3001` (admin password from
`GRAFANA_ADMIN_PASSWORD`, default `admin`), Prometheus at `http://localhost:9090`,
Tempo at `http://localhost:3200`. Dashboards: Hookline API, Delivery Engine,
Queues, Infrastructure.

```bash
pnpm check:dashboards   # fails if a dashboard references an unregistered metric
# Validate Prometheus config + alert rules without installing anything:
MSYS_NO_PATHCONV=1 docker run --rm --entrypoint promtool \
  -v "$(pwd)/infra:/etc/prometheus:ro" prom/prometheus:v3.4.0 \
  check config //etc/prometheus/prometheus.yml
```

The api serves `/metrics` on `PORT`; a worker role serves `/metrics` on its own
`PORT` via a standalone HTTP server. Traces are exported over OTLP when
`OTEL_EXPORTER_OTLP_ENDPOINT` is set (unset = dropped, no outbound calls).

### Testing & CI (Phase 14)

Coverage is enforced, not decorative: `pnpm test:cov` runs unit + integration
with V8 coverage and fails below **90% lines** overall on the core modules,
with per-file floors of 100% for signing and the auth/API-key guards, 95% for
RolesGuard, and 90% for the breaker, delivery processor, and events service
(idempotency). Measured on the full suite: **94.4% lines** across the included
core modules (2026-10-28, see LOGS.md Run 016).

Security suites run with the production posture (`ALLOW_INSECURE_ENDPOINTS`
off): connect-time SSRF blocks loopback/private/link-local/metadata targets,
IPv6 and IPv4-mapped literals, alternate IPv4 spellings, and hostnames that
resolve privately — proven through every outbound path (test send, delivery
processor, replay). An authorization matrix covers REST, tRPC, WebSocket and
internal gRPC in one place (`apps/server/test/int/authz-matrix.spec.ts`).

GitHub Actions workflows live in `.github/` (lint, typecheck, unit,
integration with Testcontainers, build, Playwright E2E, Docker image build
tagged by commit and version, Dependabot, gitleaks secret scanning, and a
`pnpm audit` gate at high severity). They are syntax-validated only — nothing
in this project has executed them remotely (LOGS.md Run 016).

### Run the full demo topology (Phase 13, verified)

```bash
docker compose -f docker-compose.dev.yml down   # free the shared project name/volumes
docker compose up --build -d --scale api=3 --scale worker=2
```

Dashboard `http://localhost:8080` (nginx edge), Grafana `http://localhost:3001`
(default admin password unless `GRAFANA_ADMIN_PASSWORD` was set when the
containers were created), Prometheus `http://localhost:9090`. The one-shot
`migrate` service applies migrations before the apps start; nginx re-resolves
api/worker replicas per request (Docker DNS) so killed replicas are routed
around within ~5s.

**Chaos demo (zero lost events, run 2026-10-26 on 12 CPU / 7.6 GB host,
3 api + 2 worker replicas). Caveat: the load generator and the system under
test share one laptop, so throughput numbers are conservative — the demo
proves correctness under kills, not peak capacity:**

```bash
node scripts/chaos/run-chaos.mjs --duration 150 --kills 4 --tracked-rate 4 --k6-rate 40
```

Latest actual run: 4 random api/worker containers SIGKILLed during
~2.5 min of load (k6 mixed workload 40 r/s + tracked stream). Result —
accepted events 1645/1645 accounted for (464 tracked + 1181 k6), 464/464
tracked deliveries succeeded, 0 non-terminal, 0 dead after drain, k6
99.97% checks passed (the 1 failure was a request in flight to a killed
replica), WebSocket stayed live through nginx with 3290 envelopes received.
This run also exposed and fixed a real gap: deliveries orphaned in
`in_progress` by a worker SIGKILL are now healed by the reconciler
(`requeueOrphanedInProgress`, regression-tested in
`apps/server/test/int/resilience.spec.ts`).

A repeat via `pnpm demo` on 2026-10-28 (same host): 294 tracked events
through 2 SIGKILLs (1 api, 1 worker) — **PASS, zero lost events**.

```bash
# Standalone load without chaos:
docker run --rm -v "$(pwd)/scripts/load:/scripts:ro" -v "$(pwd)/scripts/load/out:/out"   -e BASE_URL=http://host.docker.internal:8080 -e API_KEY=hl_live_...   grafana/k6:1.1.0 run --summary-export=/out/summary.json /scripts/ingest.js
```

## Common scripts

| Command                                | Description                                                       |
| -------------------------------------- | ----------------------------------------------------------------- |
| `pnpm dev`                             | Run web and server in watch mode                                  |
| `pnpm build`                           | Build all apps and packages                                       |
| `pnpm lint` / `pnpm typecheck`         | Lint and type-check the repo                                      |
| `pnpm test`                            | Unit tests                                                        |
| `pnpm test:int`                        | Integration tests (Testcontainers)                                |
| `pnpm test:cov`                        | Unit + integration with coverage; core-module thresholds enforced |
| `pnpm test:e2e`                        | Playwright E2E (boots API + web, needs the dev compose running)   |
| `pnpm db:generate` / `pnpm db:migrate` | Generate and apply migrations                                     |
| `pnpm db:seed`                         | Seed demo data                                                    |
| `pnpm proto:gen`                       | Generate gRPC code from `.proto` files                            |
| `pnpm check:dashboards`                | Fail if a Grafana dashboard references an unregistered metric     |

## One-command demo

Verified end to end 2026-10-28 (LOGS.md Run 016): one command brings up the
full topology through nginx, registers a healthy and a failing endpoint,
sends events, shows the live WebSocket log, replays a delivery, runs the
zero-loss chaos step (kills api/worker replicas under load), prints summary
counts, and shuts everything down:

```bash
pnpm demo
```

Exits non-zero if ANY step fails, including the zero-lost-events check. If
host port 3001 is taken the demo publishes Grafana on **3011** instead
(`docker-compose.demo-override.yml`); 8080 (nginx) and 9090 (Prometheus) must
also be free.

## Demo script (the "wow" moment)

1. Start the full topology (3 API replicas, 2 workers).
2. Register two endpoints: one healthy, one deliberately failing.
3. Send events through the REST API and watch the live log update in the dashboard.
4. Watch the failing endpoint retry with backoff, then trip its circuit breaker.
5. `docker kill` a worker mid-delivery: no events are lost and deliveries resume.
6. Click **Replay** on a failed delivery after fixing the endpoint.

## Screenshots

Captured from real runs (see `docs/screenshots/` for the full set,
including accessibility/responsive evidence):

![Dashboard overview](docs/screenshots/overview.png)

![Endpoints with live deliveries](docs/screenshots/endpoints-populated.png)

![Delivery detail with attempt timeline](docs/screenshots/delivery-detail.png)

![Grafana delivery dashboard](docs/screenshots/grafana-delivery.png)

Dark mode and a 390px-wide viewport:

![Dark mode](docs/screenshots/a11y-dark-overview.png)

![Mobile width](docs/screenshots/a11y-mobile-overview.png)

## Documentation

| Doc                                  | Purpose                                   |
| ------------------------------------ | ----------------------------------------- |
| [PRD.md](./PRD.md)                   | What we are building and why              |
| [PHASES.md](./PHASES.md)             | Build plan with progress checkboxes       |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | How the system is designed                |
| [DATA.md](./DATA.md)                 | Database schema and Redis keys            |
| [API.md](./API.md)                   | REST, tRPC, gRPC, and WebSocket contracts |
| [AGENTS.md](./AGENTS.md)             | Rules for AI coding agents                |
| [LOGS.md](./LOGS.md)                 | Agent run log                             |

## License

[MIT](./LICENSE) — see also [CONTRIBUTING.md](./CONTRIBUTING.md).
