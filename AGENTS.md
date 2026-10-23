# AGENTS.md: Rules for AI Agents Working on Hookline

You are working on **Hookline**, a multi-tenant webhook delivery platform. Read this file fully before every run. These rules override your defaults.

---

## 1. Read order (every run)

1. `AGENTS.md` (this file)
2. `PHASES.md`: find the current phase and the next unchecked task
3. `LOGS.md`: read the last 3 entries for context and blockers
4. Then, as needed for the task: `ARCHITECTURE.md`, `DATA.md`, `API.md`, `PRD.md`

If the docs conflict with each other or with the code, **stop and flag it** in LOGS.md. Don't silently pick one.

## 2. Workflow

1. Pick the **first unchecked task** in the **current phase** of `PHASES.md`. Don't skip ahead or start another phase unless the human asks.
2. Mark it `[~]` while working.
3. Implement it **with tests** (see section 6).
4. Run the verification commands (section 8). Everything must pass.
5. Update affected docs (section 9).
6. Mark the task `[x]` **only when code, tests, and docs are done and verified**.
7. **Append an entry to `LOGS.md`** (see section 10). This is mandatory after every run, even failed or partial ones.
8. If a phase's tasks are all `[x]` and its exit criteria are verified, mark the phase in the overview table.

Keep each run small and focused. A task that is too big gets split into sub-bullets in PHASES.md, and you log that.

## 3. Hard rules (never violate)

- **Never** put secrets, keys, or real credentials in code, tests, logs, fixtures, or docs. Use `.env` (git-ignored) and `.env.example` (placeholders only).
- **Never** log secrets, API keys, signatures, or full payloads at info level.
- **Never** make an outbound HTTP request to customer URLs from the `api` role. Only the `worker` role does.
- **Never** query a tenant-owned table without scoping by `organization_id`.
- **Never** read or write another module's tables. Go through its public service.
- **Never** edit an applied migration. Add a new one.
- **Never** hand-edit Better Auth generated schema or generated gRPC code. Regenerate it.
- **Never** disable lint rules, TypeScript strictness, or tests to make something pass.
- **Never** add business logic to controllers, tRPC routers, gRPC handlers, or WebSocket gateways.
- **Never** store durable-only state in Redis or in process memory.
- **Never** use `any` unless justified by an inline comment. Prefer `unknown` plus Zod parsing.
- **Never** make destructive git operations (force push, history rewrite) unless the human asks.
- **Never** create, modify, or delete files outside the project root (`C:\Users\arhat\Projects\Hookline`). - - **Never** change global tool configuration, environment variables, or system settings. Install tools only via npm (project-local preferred), never via system installers or with elevated privileges. If a task seems to require otherwise, mark it BLOCKED and log it.

## 4. Architecture rules

- Modular monolith: one codebase, `ROLE=api|worker|all`. Respect the module table in ARCHITECTURE.md.
- Import another module only through its public `index.ts`. The lint boundary rules must pass.
- Protocol layers (REST, tRPC, gRPC, WS) do exactly three things: authenticate and authorize, validate with Zod, call a service.
- Cross-module transactions use `UnitOfWork` from `platform`.
- App servers are **stateless**. State lives in Postgres or Redis. Anything in an in-memory variable must be safe to lose on restart.
- Delivery is **at-least-once**. Every consumer of a job or event must be idempotent.
- Anything that must survive a crash goes through Postgres or BullMQ, never the in-process event bus.
- Scheduled work uses BullMQ job schedulers, not `setInterval` or `node-cron`.
- Shared types and Zod schemas used by both web and server live in `packages/shared`.
- The in-process and gRPC implementations of the worker interface must stay interchangeable behind one TypeScript interface.

## 5. Code conventions

- TypeScript `strict`. No unused code, no commented-out code, no stray `console.log` (use the Pino logger).
- Files: `kebab-case.ts`. Classes: `PascalCase`. Functions and variables: `camelCase`. DB columns: `snake_case`. Constants: `SCREAMING_SNAKE_CASE`.
- Validate **all** external input with Zod (HTTP, WS messages, job payloads, env, gRPC requests).
- Errors: throw typed application errors from `platform/errors`. The global filter maps them to the standard error format in API.md. Never leak stack traces or internals in responses.
- IDs are prefixed ULIDs from the shared helper. Never use raw UUIDs or auto-increment IDs.
- Dates: UTC, `timestamptz`, ISO 8601 in APIs.
- Use dependency injection (Nest providers). No hidden singletons.
- Keep functions small and named for what they do. Comment the **why**, not the what.
- Frontend: Server state via TanStack Query (tRPC). Zustand only for client/UI state. Forms use React Hook Form + Zod. Charts use Recharts. Components come from shadcn/ui before custom ones. Animations use Motion, sparingly. Handle loading, empty, and error states in every view.
- Dependencies: add only when necessary, pin exact versions, and **record the reason in LOGS.md**. Don't add a second library for something already covered by the stack.

## 6. Testing rules

- Every task ships with tests. No tests means the task isn't done.
- Unit tests (Vitest/Jest) for pure logic: signing, backoff, breaker transitions, idempotency, validators.
- Integration tests with **Testcontainers** (real Postgres and Redis). Don't mock the database or Redis for integration tests.
- Contract tests: REST responses must match `API.md` and the OpenAPI spec.
- Security-relevant code needs negative tests (SSRF blocks, cross-tenant access, invalid signatures, revoked keys).
- Tests must be deterministic: no real network calls to the internet, no reliance on wall-clock sleeps (use fake timers or controllable clocks).
- Target coverage for core modules (`delivery-engine`, signing, breaker, idempotency, auth guards): **90% lines**. Elsewhere: use judgment, but cover every public service method.
- A flaky test is a bug. Fix or quarantine it with a note in LOGS.md, and never ignore it.

## 7. Security checklist (apply to every relevant change)

- [ ] Input validated with Zod
- [ ] Authenticated and authorized (role or scope checked)
- [ ] Query scoped by `organization_id`
- [ ] No secrets in logs, errors, or responses (except the one-time reveal on create/rotate)
- [ ] Outbound URLs go through the SSRF-safe client
- [ ] New route, procedure, or RPC is documented in API.md
- [ ] Rate limiting considered for public surfaces

## 8. Verification commands

Run these before marking any task done. All must pass.

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:int      # when the task touches DB, Redis, queues, or HTTP
pnpm build
```

If a command doesn't exist yet in the current phase, say so in LOGS.md rather than skipping silently.

## 9. Documentation sync

Update docs **in the same change** as the code:

| Change | Update |
|---|---|
| Route, tRPC procedure, gRPC RPC, WS message, error code | `API.md` |
| Migration, table, column, index, enum, Redis key | `DATA.md` |
| Module, flow, reliability behavior, config var, decision | `ARCHITECTURE.md` |
| Scope or requirement change | `PRD.md` (and tell the human) |
| Task done, task split, new task discovered | `PHASES.md` |
| Setup steps, scripts, structure | `README.md` |

## 10. Logging your run in LOGS.md

After **every** run, append an entry at the **bottom** of `LOGS.md` using the template in that file. Be specific and honest: record what you did, what you didn't, what failed, and what the next agent should do first. Never edit or delete previous entries.

## 11. Git rules

- Branch per phase or task: `phase-N/short-description`.
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`). Small, logical commits.
- Don't commit generated artifacts that are git-ignored, `.env`, or build output.
- Don't push to `main` directly unless the human says so.

## 12. When to stop and ask the human

Stop and write the question in LOGS.md (and in your reply) instead of guessing when:

- The docs contradict each other or the code
- A task requires a decision not covered by the docs (new dependency category, schema change beyond DATA.md, API contract change)
- A requirement is ambiguous in a way that affects security or data durability
- Verification fails for reasons you can't resolve after a reasonable effort
- A change would need a destructive operation or touch the git history

## 13. Definition of done

A task is done only if **all** are true:

- [ ] Behavior matches PRD, API, DATA, and ARCHITECTURE docs
- [ ] Tests written and passing (unit and integration where relevant)
- [ ] `lint`, `typecheck`, `test`, `build` pass
- [ ] Security checklist applied
- [ ] Docs updated
- [ ] `PHASES.md` checkbox updated
- [ ] `LOGS.md` entry appended