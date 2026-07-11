// P4.3 — Session manager (metadata in JSON, messages in LongTermMemory).
import { resolve } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { LongTermMemory } from '../core/memory.js';

export interface Session {
  id: string;
  name: string;
  agent: string;
  createdAt: number;
}

export class SessionManager {
  private file: string;
  private sessions: Session[] = [];
  private ltm: LongTermMemory;

  constructor(projectRoot: string, ltm: LongTermMemory) {
    const dir = resolve(projectRoot, 'data');
    mkdirSync(dir, { recursive: true });
    this.file = resolve(dir, 'sessions.json');
    this.ltm = ltm;
    if (existsSync(this.file)) {
      try {
        this.sessions = JSON.parse(readFileSync(this.file, 'utf8'));
      } catch {
        this.sessions = [];
      }
    }
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.sessions, null, 2), 'utf8');
  }

  create(name: string, agent = 'coordinator'): Session {
    const session: Session = {
      id: `s_${Date.now().toString(36)}`,
      name: name || `session-${this.sessions.length + 1}`,
      agent,
      createdAt: Date.now(),
    };
    this.sessions.push(session);
    this.save();
    return session;
  }

  list(): Session[] {
    return this.sessions;
  }

  get(id: string): Session | undefined {
    return this.sessions.find((s) => s.id === id);
  }

  setAgent(id: string, agent: string): void {
    const s = this.get(id);
    if (s) {
      s.agent = agent;
      this.save();
    }
  }

  // Rewind: discard a session's stored history, keep metadata.
  rewind(id: string): void {
    this.ltm.clearSession(id);
  }

  export(id: string): { meta: Session; messages: Array<{ role: string; content: string }> } | null {
    const meta = this.get(id);
    if (!meta) return null;
    return { meta, messages: this.ltm.get(id) };
  }
}
