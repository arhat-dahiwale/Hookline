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

| Area | Technology |
|---|---|
| Frontend | Next.js, React, TypeScript, Tailwind CSS, shadcn/ui + Radix, TanStack Query, TanStack Table, Zustand, Motion, React Hook Form, Zod, Recharts |
| Backend | Node.js, NestJS + Fastify adapter, TypeScript, Zod |
| APIs | REST + OpenAPI (public), tRPC (dashboard), gRPC + Protobuf (internal), WebSocket (live updates) |
| Data | PostgreSQL, Drizzle ORM, Redis |
| Queue | BullMQ |
| Auth | Better Auth (dashboard), custom hashed API keys (public API) |
| Observability | Pino, OpenTelemetry, Prometheus, Grafana |
| Infra | Docker, Docker Compose, nginx |
| Tooling | pnpm workspaces, Turborepo, Vitest/Jest, Supertest, Testcontainers, GitHub Actions |

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
pnpm dev                        # web on :3000, api on :4000
```

### Run the full demo topology

```bash
docker compose up --build --scale api=3 --scale worker=2
```

Then open the dashboard through nginx at `http://localhost:8080`, Grafana at `http://localhost:3001`, and Prometheus at `http://localhost:9090`.

## Common scripts

| Command | Description |
|---|---|
| `pnpm dev` | Run web and server in watch mode |
| `pnpm build` | Build all apps and packages |
| `pnpm lint` / `pnpm typecheck` | Lint and type-check the repo |
| `pnpm test` | Unit tests |
| `pnpm test:int` | Integration tests (Testcontainers) |
| `pnpm db:generate` / `pnpm db:migrate` | Generate and apply migrations |
| `pnpm db:seed` | Seed demo data |
| `pnpm proto:gen` | Generate gRPC code from `.proto` files |

## Demo script (the "wow" moment)

1. Start the full topology (3 API replicas, 2 workers).
2. Register two endpoints: one healthy, one deliberately failing.
3. Send events through the REST API and watch the live log update in the dashboard.
4. Watch the failing endpoint retry with backoff, then trip its circuit breaker.
5. `docker kill` a worker mid-delivery: no events are lost and deliveries resume.
6. Click **Replay** on a failed delivery after fixing the endpoint.

## Documentation

| Doc | Purpose |
|---|---|
| [PRD.md](./PRD.md) | What we are building and why |
| [PHASES.md](./PHASES.md) | Build plan with progress checkboxes |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | How the system is designed |
| [DATA.md](./DATA.md) | Database schema and Redis keys |
| [API.md](./API.md) | REST, tRPC, gRPC, and WebSocket contracts |
| [AGENTS.md](./AGENTS.md) | Rules for AI coding agents |
| [LOGS.md](./LOGS.md) | Agent run log |

## License

TBD