import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

export interface SessionStore {
  db: Database;
  initializeSchema(): Promise<void>;
  runMigrations(): Promise<void>;
  close(): void;
}

export async function createSessionStore(dataDir: string): Promise<SessionStore> {
  const dbPath = resolve(dataDir, 'sessions.db');
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  
  // Enable required pragmas
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('journal_mode = WAL');

  const store: SessionStore = {
    db,
    
    async initializeSchema(): Promise<void> {
      // Create tables with proper foreign key relationships
      db.exec(`
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
      `);
    },
    
    async runMigrations(): Promise<void> {
      await this.initializeSchema();
      
      // Verify foreign key integrity
      const fkCheck = db.prepare('PRAGMA foreign_key_check').all();
      if (fkCheck.length > 0) {
        console.warn('Foreign key violations detected:', fkCheck);
      }
    },
    
    close(): void {
      db.close();
    }
  };

  return store;
}
