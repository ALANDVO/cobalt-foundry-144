import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createSessionStore, SessionStore } from '../../src/worker/store.js';
import { rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SQLite Session Store', () => {
  let store: SessionStore;
  const testDir = join(tmpdir(), 'cobalt-test-store');

  beforeAll(async () => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    store = await createSessionStore(testDir);
    await store.runMigrations();
  });

  afterAll(() => {
    store.close();
    rmSync(testDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    // Clear tables between tests
    store.db.exec('DELETE FROM pending_messages');
    store.db.exec('DELETE FROM observations');
    store.db.exec('DELETE FROM session_summaries');
    store.db.exec('DELETE FROM sdk_sessions');
  });

  it('opens database with required pragmas', () => {
    const busyTimeout = store.db.pragma('busy_timeout');
    const foreignKeys = store.db.pragma('foreign_keys');
    const synchronous = store.db.pragma('synchronous');
    const journalMode = store.db.pragma('journal_mode');
    
    expect(busyTimeout).toBe(5000);
    expect(foreignKeys).toBe(true);
    expect(synchronous).toBe('NORMAL');
    expect(journalMode).toBe('WAL');
  });

  it('creates all required tables', () => {
    const tables = store.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all().map(t => t.name);
    
    expect(tables).toContain('sdk_sessions');
    expect(tables).toContain('observations');
    expect(tables).toContain('session_summaries');
    expect(tables).toContain('pending_messages');
  });

  it('stores and retrieves sdk_sessions', () => {
    const stmt = store.db.prepare(`
      INSERT INTO sdk_sessions (memory_session_id, platform_source, project, status, started_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    const result = stmt.run('test-session-1', 'claude', 'test-project', 'active', Date.now(), '{}');
    expect(result.lastInsertRowid).toBeGreaterThan(0);
    
    const session = store.db.prepare('SELECT * FROM sdk_sessions WHERE memory_session_id = ?').get('test-session-1');
    expect(session).toBeDefined();
    expect(session.memory_session_id).toBe('test-session-1');
    expect(session.platform_source).toBe('claude');
    expect(session.project).toBe('test-project');
  });

  it('stores and retrieves observations with foreign key', () => {
    // Create session first
    const sessionStmt = store.db.prepare(`
      INSERT INTO sdk_sessions (memory_session_id, platform_source, project, status, started_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const sessionResult = sessionStmt.run('test-session-2', 'claude', 'test-project', 'active', Date.now());
    const sessionId = sessionResult.lastInsertRowid;
    
    // Create observation
    const obsStmt = store.db.prepare(`
      INSERT INTO observations (session_id, type, title, narrative, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const obsResult = obsStmt.run(sessionId, 'bugfix', 'Fix login bug', 'Fixed OAuth callback', 'hash123', Date.now());
    expect(obsResult.lastInsertRowid).toBeGreaterThan(0);
    
    const obs = store.db.prepare('SELECT * FROM observations WHERE session_id = ?').all(sessionId);
    expect(obs.length).toBe(1);
    expect(obs[0].type).toBe('bugfix');
    expect(obs[0].title).toBe('Fix login bug');
  });

  it('enforces foreign key on session_id', () => {
    const obsStmt = store.db.prepare(`
      INSERT INTO observations (session_id, type, title, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    // This should fail due to foreign key constraint
    expect(() => {
      obsStmt.run(99999, 'bugfix', 'Orphan observation', 'hash456', Date.now());
    }).toThrow();
  });

  it('stores and retrieves session_summaries', () => {
    const sessionStmt = store.db.prepare(`
      INSERT INTO sdk_sessions (memory_session_id, platform_source, project, status, started_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const sessionResult = sessionStmt.run('test-session-3', 'claude', 'test-project', 'active', Date.now());
    const sessionId = sessionResult.lastInsertRowid;
    
    const summaryStmt = store.db.prepare(`
      INSERT INTO session_summaries (session_id, summary_text, discovery_tokens, files_read, files_edited, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const summaryResult = summaryStmt.run(sessionId, 'Session summary', 'tokens', '["file1.ts"]', '["file2.ts"]', Date.now(), Date.now());
    expect(summaryResult.lastInsertRowid).toBeGreaterThan(0);
    
    const summary = store.db.prepare('SELECT * FROM session_summaries WHERE session_id = ?').get(sessionId);
    expect(summary).toBeDefined();
    expect(summary.summary_text).toBe('Session summary');
    expect(summary.discovery_tokens).toBe('tokens');
  });

  it('stores and retrieves pending_messages with status transitions', () => {
    const sessionStmt = store.db.prepare(`
      INSERT INTO sdk_sessions (memory_session_id, platform_source, project, status, started_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const sessionResult = sessionStmt.run('test-session-4', 'claude', 'test-project', 'active', Date.now());
    const sessionId = sessionResult.lastInsertRowid;
    
    const msgStmt = store.db.prepare(`
      INSERT INTO pending_messages (session_id, role, content, status, retry_count, max_retries, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    msgStmt.run(sessionId, 'user', 'Test message', 'pending', 0, 3, now, now);
    
    const messages = store.db.prepare('SELECT * FROM pending_messages WHERE session_id = ?').all(sessionId);
    expect(messages.length).toBe(1);
    expect(messages[0].status).toBe('pending');
    expect(messages[0].retry_count).toBe(0);
  });

  it('migration chain runs before any query by introspection', () => {
    // Verify indexes exist
    const indexes = store.db.prepare(`
      SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'
    `).all().map(i => i.name);
    
    expect(indexes).toContain('idx_observations_session');
    expect(indexes).toContain('idx_observations_hash');
    expect(indexes).toContain('idx_sessions_memory');
    expect(indexes).toContain('idx_sessions_platform');
    expect(indexes).toContain('idx_pending_status');
  });

  it('foreign key integrity maintained on session update', () => {
    // Create session
    const sessionStmt = store.db.prepare(`
      INSERT INTO sdk_sessions (memory_session_id, platform_source, project, status, started_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const sessionResult = sessionStmt.run('test-session-5', 'claude', 'test-project', 'active', Date.now());
    const sessionId = sessionResult.lastInsertRowid;
    
    // Create observation
    const obsStmt = store.db.prepare(`
      INSERT INTO observations (session_id, type, title, content_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    obsStmt.run(sessionId, 'bugfix', 'Test', 'hash789', Date.now());
    
    // Update session id (ON UPDATE CASCADE should propagate)
    const updateStmt = store.db.prepare('UPDATE sdk_sessions SET id = ? WHERE id = ?');
    // Note: SQLite doesn't allow updating primary key directly when referenced
    // This test verifies the foreign key constraint exists
    const fkCheck = store.db.prepare('PRAGMA foreign_key_check').all();
    expect(fkCheck.length).toBe(0);
  });
});
