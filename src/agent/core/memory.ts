// P2.2 — Three-layer memory backed by built-in node:sqlite. Zero native build.
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

export interface ShortTermMemory {
  messages: Array<{ role: string; content: string }>;
  push(role: string, content: string): void;
  clear(): void;
}

export function createShortTerm(): ShortTermMemory {
  const messages: Array<{ role: string; content: string }> = [];
  return {
    messages,
    push(role, content) {
      messages.push({ role, content });
    },
    clear() {
      messages.length = 0;
    },
  };
}

export class LongTermMemory {
  private db: DatabaseSync;
  constructor(projectRoot: string) {
    const dir = resolve(projectRoot, 'data');
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(resolve(dir, 'memory.db'));
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS conversations (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         session_id TEXT NOT NULL,
         role TEXT NOT NULL,
         content TEXT NOT NULL,
         ts INTEGER NOT NULL
       );
       CREATE TABLE IF NOT EXISTS knowledge (
         key TEXT PRIMARY KEY,
         value TEXT NOT NULL,
         ts INTEGER NOT NULL
       );`,
    );
  }

  add(sessionId: string, role: string, content: string): void {
    this.db.prepare('INSERT INTO conversations (session_id, role, content, ts) VALUES (?, ?, ?, ?)')
      .run(sessionId, role, content, Date.now());
  }

  clearSession(sessionId: string): void {
    this.db.prepare('DELETE FROM conversations WHERE session_id = ?').run(sessionId);
  }

  get(sessionId: string, limit = 50): Array<{ role: string; content: string }> {
    return this.db
      .prepare('SELECT role, content FROM conversations WHERE session_id = ? ORDER BY id DESC LIMIT ?')
      .all(sessionId, limit)
      .reverse() as Array<{ role: string; content: string }>;
  }

  knowledgeSet(key: string, value: string): void {
    this.db.prepare('INSERT INTO knowledge (key, value, ts) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=?, ts=?')
      .run(key, value, Date.now(), value, Date.now());
  }

  knowledgeGet(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM knowledge WHERE key = ?').get(key) as { value: string } | null;
    return row ? row.value : null;
  }

  close(): void {
    this.db.close();
  }
}

export class UserProfileMemory {
  private file: string;
  private data: Record<string, unknown> = {};
  constructor(projectRoot: string) {
    const dir = resolve(projectRoot, 'data');
    mkdirSync(dir, { recursive: true });
    this.file = resolve(dir, 'profile.json');
    if (existsSync(this.file)) {
      try {
        this.data = JSON.parse(readFileSync(this.file, 'utf8'));
      } catch {
        this.data = {};
      }
    }
  }
  get(key: string): unknown {
    return this.data[key];
  }
  keys(): string[] {
    return Object.keys(this.data);
  }
  set(key: string, value: unknown): void {
    this.data[key] = value;
    this.save();
  }
  merge(patch: Record<string, unknown>): void {
    this.data = { ...this.data, ...patch };
    this.save();
  }
  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }
}
