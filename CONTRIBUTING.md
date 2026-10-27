# Contributing to Hookline

Thanks for your interest in contributing! This document covers the practical
rules; `AGENTS.md` has the full engineering standards (written for AI agents,
but humans are held to them too).

## Getting started

```bash
pnpm install                 # pnpm 12, Node 24 (see .nvmrc)
docker compose -f docker-compose.dev.yml up -d   # Postgres + Redis
cp .env.example .env         # then fill in the generated secrets
pnpm db:migrate              # apply the schema
pnpm dev                     # api (4000) + web (3100)
```

## Ground rules

- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `test:`,
  `refactor:`). Small, logical commits.
- Branch per task: `phase-N/short-description` or `feat/short-description`.
- Never commit secrets. `.env` is git-ignored; `.env.example` holds
  placeholders only. Secret scanning (gitleaks) runs in CI.
- TypeScript `strict`, no `any` without an inline justification. All external
  input is validated with Zod.
- Queries on tenant-owned tables must be scoped by `organization_id`.
- Protocol layers (REST, tRPC, gRPC, WebSocket) only authenticate, validate,
  and call a service — no business logic there.
- Outbound HTTP goes through the SSRF-safe client only.

## Tests

Every change ships with tests; a task without tests is not done.

```bash
pnpm test        # unit (Vitest)
pnpm test:int    # integration (Testcontainers: real Postgres + Redis)
pnpm test:cov    # both with coverage; core-module thresholds are enforced
pnpm test:e2e    # Playwright dashboard journey (needs the dev compose)
pnpm lint && pnpm typecheck && pnpm build
```

Integration tests must not mock the database or Redis. Tests must be
deterministic — no internet calls, no wall-clock sleeps. A flaky test is a
bug: fix it or quarantine it with a written reason.

## Docs live with the code

| Change                                        | Update            |
| --------------------------------------------- | ----------------- |
| Route, procedure, RPC, WS message, error code | `API.md`          |
| Migration, table, index, enum, Redis key      | `DATA.md`         |
| Module, flow, config var, decision            | `ARCHITECTURE.md` |
| Scope or requirement                          | `PRD.md`          |
| Task status                                   | `PHASES.md`       |

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
