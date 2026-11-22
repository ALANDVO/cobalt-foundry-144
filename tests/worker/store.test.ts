import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  createSessionStore,
  createSession,
  getSessionByMemoryId,
  completeSession,
  createObservation,
  listObservations,
  createSummary,
  createPendingMessage,
  transitionPendingMessage,
  retryPendingMessage,
  foreignKeyViolations,
  type SessionStore,
} from '../../src/worker/store.js';
import { rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SQLite Session Store', () => {
  let store: SessionStore;
  const testDir = join(tmpdir(), `cobalt-test-store-${process.pid}`);

  beforeAll(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    store = createSessionStore(testDir);
    store.runMigrations();
  });

  afterAll(() => {
    store.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    store.raw.exec('DELETE FROM pending_messages');
    store.raw.exec('DELETE FROM observations');
    store.raw.exec('DELETE FROM session_summaries');
    store.raw.exec('DELETE FROM sdk_sessions');
  });

  it('opens database with required pragmas (busy_timeout, foreign_keys, synchronous)', () => {
    const busyTimeout = store.raw.prepare('PRAGMA busy_timeout').get() as { timeout: number };
    const foreignKeys = store.raw.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    const synchronous = store.raw.prepare('PRAGMA synchronous').get() as { synchronous: number };
    const journalMode = store.raw.prepare('PRAGMA journal_mode').get() as { journal_mode: string };

    expect(busyTimeout.timeout).toBe(5000);
    expect(foreignKeys.foreign_keys).toBe(1);
    // synchronous=1 is NORMAL (0=OFF, 1=NORMAL, 2=FULL, 3=EXTRA)
    expect(synchronous.synchronous).toBe(1);
    expect(String(journalMode.journal_mode).toLowerCase()).toBe('wal');
  });

  it('creates all required tables', () => {
    const tables = (store.raw.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`,
    ).all() as Array<{ name: string }>).map(t => t.name);

    expect(tables).toContain('sdk_sessions');
    expect(tables).toContain('observations');
    expect(tables).toContain('session_summaries');
    expect(tables).toContain('pending_messages');
  });

  it('stores and retrieves sdk_sessions and reaches completed status', () => {
    const session = createSession(store, {
      memorySessionId: 'test-session-1',
      platformSource: 'claude',
      project: 'test-project',
      startedAt: Date.now(),
      metadata: '{}',
    });

    expect(session.id).toBeGreaterThan(0);
    const fetched = getSessionByMemoryId(store, 'test-session-1');
    expect(fetched).toBeDefined();
    expect(fetched?.platform_source).toBe('claude');
    expect(fetched?.status).toBe('active');

    completeSession(store, session.id, Date.now());
    const completed = store.prepare('SELECT * FROM sdk_sessions WHERE id = ?').get(session.id) as { status: string; completed_at: number | null };
    expect(completed.status).toBe('completed');
    expect(completed.completed_at).not.toBeNull();
  });

  it('stores and retrieves observations with foreign key', () => {
    const session = createSession(store, {
      memorySessionId: 'test-session-2',
      platformSource: 'claude',
      project: 'test-project',
      startedAt: Date.now(),
    });

    const obsId = createObservation(store, {
      sessionId: session.id,
      type: 'bugfix',
      title: 'Fix login bug',
      narrative: 'Fixed OAuth callback',
      contentHash: 'hash123',
      createdAt: Date.now(),
    });
    expect(obsId).toBeGreaterThan(0);

    const obs = listObservations(store, session.id);
    expect(obs.length).toBe(1);
    expect(obs[0].type).toBe('bugfix');
    expect(obs[0].title).toBe('Fix login bug');
  });

  it('enforces foreign key on session_id', () => {
    expect(() => createObservation(store, {
      sessionId: 99999,
      type: 'bugfix',
      title: 'Orphan observation',
      contentHash: 'hash456',
      createdAt: Date.now(),
    })).toThrow();
    expect(foreignKeyViolations(store).length).toBe(0);
  });

  it('stores and retrieves session_summaries', () => {
    const session = createSession(store, {
      memorySessionId: 'test-session-3',
      platformSource: 'claude',
      project: 'test-project',
      startedAt: Date.now(),
    });

    const now = Date.now();
    const summaryId = createSummary(store, {
      sessionId: session.id,
      summaryText: 'Session summary',
      discoveryTokens: 'tokens',
      filesRead: '["file1.ts"]',
      filesEdited: '["file2.ts"]',
      createdAt: now,
      updatedAt: now,
    });
    expect(summaryId).toBeGreaterThan(0);

    const summary = store.prepare('SELECT * FROM session_summaries WHERE session_id = ?').get(session.id) as { summary_text: string; discovery_tokens: string };
    expect(summary.summary_text).toBe('Session summary');
    expect(summary.discovery_tokens).toBe('tokens');
  });

  it('pending_messages transitions pending -> processing -> completed and retry increments', () => {
    const session = createSession(store, {
      memorySessionId: 'test-session-4',
      platformSource: 'claude',
      project: 'test-project',
      startedAt: Date.now(),
    });

    const now = Date.now();
    const msgId = createPendingMessage(store, {
      sessionId: session.id,
      role: 'user',
      content: 'Test message',
      createdAt: now,
      updatedAt: now,
    });
    expect(msgId).toBeGreaterThan(0);

    let row = store.prepare('SELECT * FROM pending_messages WHERE id = ?').get(msgId) as { status: string; retry_count: number };
    expect(row.status).toBe('pending');
    expect(row.retry_count).toBe(0);

    transitionPendingMessage(store, msgId, 'processing', now + 1);
    row = store.prepare('SELECT * FROM pending_messages WHERE id = ?').get(msgId) as { status: string; retry_count: number };
    expect(row.status).toBe('processing');

    transitionPendingMessage(store, msgId, 'completed', now + 2);
    row = store.prepare('SELECT * FROM pending_messages WHERE id = ?').get(msgId) as { status: string; retry_count: number };
    expect(row.status).toBe('completed');

    retryPendingMessage(store, msgId, now + 3);
    row = store.prepare('SELECT * FROM pending_messages WHERE id = ?').get(msgId) as { status: string; retry_count: number };
    expect(row.status).toBe('pending');
    expect(row.retry_count).toBe(1);
  });

  it('migration chain runs before any query by creating all indexes', () => {
    const indexes = (store.raw.prepare(
      `SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'`,
    ).all() as Array<{ name: string }>).map(i => i.name);

    expect(indexes).toContain('idx_observations_session');
    expect(indexes).toContain('idx_observations_hash');
    expect(indexes).toContain('idx_sessions_memory');
    expect(indexes).toContain('idx_sessions_platform');
    expect(indexes).toContain('idx_pending_status');
  });

  it('foreign key integrity maintained (foreign_key_check empty)', () => {
    const session = createSession(store, {
      memorySessionId: 'test-session-5',
      platformSource: 'claude',
      project: 'test-project',
      startedAt: Date.now(),
    });
    createObservation(store, {
      sessionId: session.id,
      type: 'bugfix',
      title: 'Test',
      contentHash: 'hash789',
      createdAt: Date.now(),
    });

    expect(foreignKeyViolations(store).length).toBe(0);
  });
});
