// Enterprise layer — lightweight auth, multi-tenant (logical isolation), and usage metrics.
// Zero extra deps: node:crypto + node:sqlite (already used by memory). No Auth0/OIDC.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

export interface TokenInfo {
  valid: boolean;
  isAdmin: boolean;
  tenantId: string;
  label?: string;
}

export interface TenantRow {
  tenant_id: string;
  label: string;
  is_admin: number;
  created_at: number;
}

// Auth: one admin token (env or auto-generated) + per-tenant API keys stored in SQLite.
export class AuthService {
  private db: DatabaseSync;
  private adminToken: string;

  constructor(root: string) {
    const dbPath = resolve(root, 'data', 'auth.db');
    this.db = new DatabaseSync(dbPath);
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS tokens (
         id TEXT PRIMARY KEY, tenant_id TEXT, label TEXT, created_at INTEGER, is_admin INTEGER DEFAULT 0
       )`,
    );
    this.adminToken = process.env.ADMIN_TOKEN || randomBytes(24).toString('hex');
    const exists = this.db.prepare('SELECT 1 FROM tokens WHERE is_admin=1').get();
    if (!exists) {
      this.db
        .prepare('INSERT OR IGNORE INTO tokens (id, tenant_id, label, created_at, is_admin) VALUES (?,?,?,?,1)')
        .run(this.adminToken, 'admin', 'admin');
    }
    if (!process.env.ADMIN_TOKEN) {
      console.log(`\n[enterprise] ADMIN_TOKEN not set — auto-generated:\n            ${this.adminToken}\n            (set ADMIN_TOKEN env to pin it)\n`);
    }
  }

  getAdminToken(): string {
    return this.adminToken;
  }

  validate(token?: string): TokenInfo {
    if (!token) return { valid: false, isAdmin: false, tenantId: '' };
    const row = this.db
      .prepare('SELECT tenant_id, label, is_admin FROM tokens WHERE id=?')
      .get(token) as { tenant_id: string; label: string; is_admin: number } | undefined;
    if (!row) return { valid: false, isAdmin: false, tenantId: '' };
    return { valid: true, isAdmin: !!row.is_admin, tenantId: row.tenant_id, label: row.label };
  }

  createTenantToken(label: string): { token: string; tenantId: string } {
    const token = randomBytes(24).toString('hex');
    const tenantId = 't_' + token.slice(0, 8);
    this.db
      .prepare('INSERT INTO tokens (id, tenant_id, label, created_at, is_admin) VALUES (?,?,?,?,0)')
      .run(token, tenantId, label, Date.now());
    return { token, tenantId };
  }

  listTokens(): TenantRow[] {
    return this.db
      .prepare('SELECT tenant_id, label, is_admin, created_at FROM tokens ORDER BY created_at')
      .all() as unknown as TenantRow[];
  }
}

// In-memory usage metrics (per request). Snapshot exposed via /api/admin/stats.
export class Metrics {
  private reqs = 0;
  private errors = 0;
  private tokens = 0;
  private perTenant: Record<string, { reqs: number; tokens: number; errors: number }> = {};

  record(tenantId: string, tokensUsed: number, ok: boolean): void {
    this.reqs++;
    if (!ok) this.errors++;
    this.tokens += tokensUsed;
    const t = this.perTenant[tenantId] || (this.perTenant[tenantId] = { reqs: 0, tokens: 0, errors: 0 });
    t.reqs++;
    t.tokens += tokensUsed;
    if (!ok) t.errors++;
  }

  snapshot() {
    return {
      totalRequests: this.reqs,
      totalErrors: this.errors,
      totalTokens: this.tokens,
      successRate: this.reqs ? Number(((this.reqs - this.errors) / this.reqs).toFixed(4)) : 1,
      perTenant: this.perTenant,
    };
  }
}

// Pull bearer / api-key token from request headers.
export function extractToken(req: { headers: Record<string, string | string[] | undefined> }): string | undefined {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const key = req.headers['x-api-key'];
  if (typeof key === 'string') return key;
  if (Array.isArray(key)) return key[0];
  return undefined;
}
