# Cobalt Foundry 144 - Alan Vo

> Work in progress. This checkpoint may be incomplete or fail tests. See PLAN.md and STATUS.md before use.


Persistent Context Across Sessions for Every Agent – Captures everything your agent does during sessions, compresses it with AI, and injects relevant context back into future sessions. Works with Claude Code, OpenClaw, Codex, Gemini, Hermes, Copilot, OpenCode + More.

## Status

This is a fresh implementation checkpoint. Core worker skeleton is complete with health endpoints.

## Quick Start

```bash
# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Start worker
npm start
```

## API Endpoints

- `GET /api/health` - Returns worker status, startToken, bootId, uptime
- `GET /api/readiness` - Returns readiness checks (database, port)

## Configuration

Environment variables:
- `CLAUDE_MEM_WORKER_PORT` - Worker port (default: 37777)
- `CLAUDE_MEM_WORKER_HOST` - Worker host (default: 127.0.0.1)
- `CLAUDE_MEM_DATA_DIR` - Data directory (default: ~/.claude-mem)
- `CLAUDE_MEM_LOG_LEVEL` - Log level (default: info)
- `CLAUDE_MEM_API_TIMEOUT_MS` - API timeout (default: 30000)
- `CLAUDE_MEM_HEALTH_PROBE_TIMEOUT_MS` - Health probe timeout (default: 5000)
- `CLAUDE_MEM_GRACEFUL_SHUTDOWN_MS` - Graceful shutdown timeout (default: 10000)

Or create `claude-mem.yaml` in the working directory.

## Architecture

This implementation follows the plan series from the reference project:
- Plan-14: Child Process Ownership
- Plan-15: Worker Port & Liveness Authority
- Plan-17: Hook Wrapper Contract
- Plan-18: Observer Response Pipeline
- Plan-19: Observer Subprocess Isolation
- Plan-21: SQLite Schema Evolution & Queue State Integrity
- Plan-24: Server Runtime & Cloud Sync Contract

## Development

```bash
# Development mode with auto-reload
npm run dev

# Type checking
npm run typecheck

# Linting
npm run lint
```

Maintainer: Alan Vo <alanvo@gmail.com>
