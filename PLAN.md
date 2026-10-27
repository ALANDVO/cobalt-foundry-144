# Product development plan

Each round completes one feature or repair. Future items are planned, not implemented claims.

## Current round

core-worker-skeleton

## Roadmap

### core-worker-skeleton — Core Worker Skeleton with Health Endpoint

Status: done

Acceptance:
- Worker process starts and binds to configured port
- /api/health returns {status: 'ok', startToken, bootId}
- /api/readiness returns {ready: true} after initialization
- Graceful shutdown on SIGTERM/SIGINT
- Basic logging to stdout/stderr

Implementation: `src/worker/index.ts`, `src/worker/config.ts`, `src/worker/health.ts`

Tests: `tests/worker/health.test.ts`

### sqlite-session-store — SQLite Session Store with Migrations

Status: planned

Acceptance:
- Database opens with pragmas (busy_timeout, foreign_keys, synchronous)
- Migration chain runs before any query by introspection
- Can store and retrieve sdk_sessions, observations, session_summaries
- Foreign key integrity maintained

### observer-response-pipeline — Observer Response Pipeline (plan-18)

Status: planned

Acceptance:
- Output classifier returns closed enum for all model responses
- Policy table maps each class to preserve/confirm/abort action
- Token budget enforced on conversation history
- Skip sentinel (<skip_summary/>) accepted and confirmed

### hook-wrapper-contract — Hook Wrapper Contract (plan-17)

Status: planned

Acceptance:
- Hook wrapper adds <60ms overhead on Unix, <300ms on Windows
- Fail-open: worker unreachable returns {continue: true} exit 0
- No login shell spawned when node on PATH
- Stdin never touched before bun-runner

### child-process-ownership — Child Process Ownership (plan-14)

Status: planned

Acceptance:
- Process registry keyed by PID with startToken
- Children spawned in own process group
- Boot sweep kills orphaned children
- Shutdown cascade kills all children before exit

### liveness-authority — Worker Port & Liveness Authority (plan-15)

Status: planned

Acceptance:
- Owner record with startToken written to worker-port.json
- Health endpoint echoes startToken and bootId
- Non-inheritable listener socket
- Reclaim policy: SIGTERM -> SIGKILL -> port relocation

