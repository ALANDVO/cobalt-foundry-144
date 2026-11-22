import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

/**
 * SQLite session store.
 *
 * Uses Node's built-in `node:sqlite` (stable in Node 22.5+/24) so the worker
 * has zero native-addon build steps. The database is opened with the pragmas
 * required by the acceptance criteria: a busy timeout, enforced foreign keys,
 * NORMAL synchronous mode, and WAL journaling.
 */

type SQLInput = string | number | bigint | boolean | null | Uint8Array;
type Row = Record<string, unknown>;

/** Minimal statement wrapper so callers get a predictable binding signature. */
export interface BoundStatement {
  run(...params: SQLInput[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...params: SQLInput[]): Row | undefined;
  all(...params: SQLInput[]): Row[];
}

export interface SessionStore {
  /** Raw handle for advanced callers; prefer the typed helpers below. */
  readonly raw: DatabaseSync;
  initializeSchema(): void;
  runMigrations(): void;
  prepare(sql: string): BoundStatement;
  close(): void;
}

export interface NewSession {
  memorySessionId: string;
  platformSource: string;
  project?: string | null;
  status?: string;
  startedAt: number;
  metadata?: string | null;
}

export interface SessionRecord {
  id: number;
  memory_session_id: string;
  platform_source: string;
  project: string | null;
  status: string;
  started_at: number;
  completed_at: number | null;
  metadata: string | null;
}

export interface NewObservation {
  sessionId: number;
  type: string;
  title: string;
  narrative?: string | null;
  filesRead?: string | null;
  filesEdited?: string | null;
  contentHash: string;
  createdAt: number;
}

export interface NewSummary {
  sessionId: number;
  summaryText: string;
  discoveryTokens?: string | null;
  filesRead?: string | null;
  filesEdited?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NewPendingMessage {
  sessionId: number;
  role: string;
  content: string;
  status?: string;
  maxRetries?: number;
  createdAt: number;
  updatedAt: number;
}

/** Normalize a node:sqlite row result into a plain object. */
function toRow(value: unknown): Row | undefined {
  if (value === undefined || value === null) return undefined;
  return value as Row;
}

/** Adapt a raw StatementSync to the narrower BoundStatement contract. */
function bindStatement(stmt: StatementSync): BoundStatement {
  return {
    run(...params) {
      const r = stmt.run(...(params as never[]));
      return { changes: r.changes, lastInsertRowid: Number(r.lastInsertRowid) };
    },
    get(...params) {
      return toRow(stmt.get(...(params as never[])));
    },
    all(...params) {
      return stmt.all(...(params as never[])) as Row[];
    },
  };
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS sdk_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memory_session_id TEXT NOT NULL UNIQUE,
    platform_source TEXT NOT NULL,
    project TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    metadata TEXT
  );

  CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    narrative TEXT,
    files_read TEXT,
    files_edited TEXT,
    relevance_count INTEGER DEFAULT 0,
    content_hash TEXT NOT NULL,
    occurrence_count INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sdk_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS session_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL UNIQUE,
    summary_text TEXT NOT NULL,
    discovery_tokens TEXT,
    files_read TEXT,
    files_edited TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sdk_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pending_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sdk_sessions(id) ON UPDATE CASCADE ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_observations_session ON observations(session_id);
  CREATE INDEX IF NOT EXISTS idx_observations_hash ON observations(content_hash);
  CREATE INDEX IF NOT EXISTS idx_sessions_memory ON sdk_sessions(memory_session_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_platform ON sdk_sessions(platform_source);
  CREATE INDEX IF NOT EXISTS idx_pending_status ON pending_messages(status);
`;

export function createSessionStore(dataDir: string): SessionStore {
  const dbPath = resolve(dataDir, 'sessions.db');
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);

  // Required pragmas: busy_timeout, foreign_keys, synchronous, WAL journaling.
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA journal_mode = WAL');

  let initialized = false;

  const store: SessionStore = {
    raw: db,

    initializeSchema(): void {
      db.exec(SCHEMA_SQL);
      initialized = true;
    },

    runMigrations(): void {
      // Migrations run before any query; initialization is idempotent so a
      // partially-applied schema from an earlier crash is repaired here.
      this.initializeSchema();

      const violations = db.prepare('PRAGMA foreign_key_check').all() as Row[];
      if (violations.length > 0) {
        console.warn('Foreign key violations detected:', violations);
      }
    },

    prepare(sql: string): BoundStatement {
      if (!initialized) {
        throw new Error('Session store used before runMigrations()/initializeSchema()');
      }
      return bindStatement(db.prepare(sql));
    },

    close(): void {
      db.close();
    },
  };

  return store;
}

// ---------------------------------------------------------------------------
// Typed CRUD helpers (thin, boring wrappers over prepared statements).
// ---------------------------------------------------------------------------

export function createSession(store: SessionStore, session: NewSession): SessionRecord {
  const res = store.prepare(
    `INSERT INTO sdk_sessions
       (memory_session_id, platform_source, project, status, started_at, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    session.memorySessionId,
    session.platformSource,
    session.project ?? null,
    session.status ?? 'active',
    session.startedAt,
    session.metadata ?? null,
  );
  const row = store.prepare('SELECT * FROM sdk_sessions WHERE id = ?').get(Number(res.lastInsertRowid));
  if (!row) throw new Error(`Failed to read back inserted session ${res.lastInsertRowid}`);
  return row as unknown as SessionRecord;
}

export function getSessionByMemoryId(store: SessionStore, memorySessionId: string): Row | undefined {
  return store.prepare('SELECT * FROM sdk_sessions WHERE memory_session_id = ?').get(memorySessionId);
}

export function completeSession(store: SessionStore, id: number, completedAt: number): void {
  store.prepare('UPDATE sdk_sessions SET status = ?, completed_at = ? WHERE id = ?')
    .run('completed', completedAt, id);
}

export function createObservation(store: SessionStore, obs: NewObservation): number {
  const res = store.prepare(
    `INSERT INTO observations
       (session_id, type, title, narrative, files_read, files_edited, content_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    obs.sessionId,
    obs.type,
    obs.title,
    obs.narrative ?? null,
    obs.filesRead ?? null,
    obs.filesEdited ?? null,
    obs.contentHash,
    obs.createdAt,
  );
  return Number(res.lastInsertRowid);
}

export function listObservations(store: SessionStore, sessionId: number): Row[] {
  return store.prepare('SELECT * FROM observations WHERE session_id = ? ORDER BY id').all(sessionId);
}

export function createSummary(store: SessionStore, summary: NewSummary): number {
  const res = store.prepare(
    `INSERT INTO session_summaries
       (session_id, summary_text, discovery_tokens, files_read, files_edited, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    summary.sessionId,
    summary.summaryText,
    summary.discoveryTokens ?? null,
    summary.filesRead ?? null,
    summary.filesEdited ?? null,
    summary.createdAt,
    summary.updatedAt,
  );
  return Number(res.lastInsertRowid);
}

export function createPendingMessage(store: SessionStore, msg: NewPendingMessage): number {
  const res = store.prepare(
    `INSERT INTO pending_messages
       (session_id, role, content, status, max_retries, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    msg.sessionId,
    msg.role,
    msg.content,
    msg.status ?? 'pending',
    msg.maxRetries ?? 3,
    msg.createdAt,
    msg.updatedAt,
  );
  return Number(res.lastInsertRowid);
}

export function transitionPendingMessage(store: SessionStore, id: number, status: string, updatedAt: number): void {
  store.prepare('UPDATE pending_messages SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, updatedAt, id);
}

export function retryPendingMessage(store: SessionStore, id: number, updatedAt: number): Row | undefined {
  store.prepare(
    `UPDATE pending_messages
       SET status = 'pending', retry_count = retry_count + 1, updated_at = ?
     WHERE id = ?`,
  ).run(updatedAt, id);
  return store.prepare('SELECT * FROM pending_messages WHERE id = ?').get(id);
}

export function foreignKeyViolations(store: SessionStore): Row[] {
  return store.prepare('PRAGMA foreign_key_check').all();
}
