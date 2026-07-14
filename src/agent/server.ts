// P2/P4 HTTP server — exposes the kernel over HTTP so a web UI can drive it.
// Zero extra deps: Node's built-in http. Reuses tools/memory/llm/team modules.
// Enterprise layer: lightweight auth, multi-tenant (logical), usage metrics, admin API.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname, normalize } from 'node:path';
import { loadEnv } from '../utils/env.js';
import { LongTermMemory, UserProfileMemory, createShortTerm } from './core/memory.js';
import { compactContext, type ChatMessage } from './core/context.js';
import { QueryEngine, type LlmTool } from './brain/llm.js';
import { SYSTEM_PROMPTS } from './brain/prompts.js';
import { AGENTS } from './team/agents.js';
import { SessionManager } from './team/session.js';
import { TOOLS } from './core/tools.js';
import { AuthService, Metrics, extractToken } from './enterprise/auth.js';

loadEnv();
const ROOT = process.cwd();
const PORT = Number(process.env.PORT) || 8787;
const WEB_OUT = resolve(ROOT, 'web', 'out'); // Next.js static export dir

const llm = new QueryEngine();
const ltm = new LongTermMemory(ROOT);
const profile = new UserProfileMemory(ROOT);
const short = createShortTerm();
const sessions = new SessionManager(ROOT, ltm);
const auth = new AuthService(ROOT);
const metrics = new Metrics();
const BRAND = {
  name: process.env.ENTERPRISE_NAME || 'AI Agent Kernel',
  logo: process.env.ENTERPRISE_LOGO || '',
};
const TOOL_SCHEMA: LlmTool[] = Object.values(TOOLS).map((t) => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.schema },
}));

function resolveSession(id: string | undefined, agent: string | undefined): string {
  let sid = id || sessions.list()[0]?.id;
  if (!sid) sid = sessions.create('default', agent || 'coordinator').id;
  if (agent) sessions.setAgent(sid, agent);
  return sid;
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolvePromise, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolvePromise(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, code: number, obj: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
  return;
}

// Require a valid token (admin or tenant). Returns TokenInfo or sends 401 and returns null.
function requireAuth(req: http.IncomingMessage, res: http.ServerResponse): ReturnType<AuthService['validate']> | null {
  const info = auth.validate(extractToken(req));
  if (!info.valid) {
    sendJson(res, 401, { ok: false, error: 'unauthorized: provide Authorization: Bearer <token>' });
    return null;
  }
  return info;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  let pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  if (pathname === '/') pathname = '/index.html';
  const safe = normalize(join(WEB_OUT, pathname)).replace(/^(\.\.[/\\])+/, '');
  const target = resolve(WEB_OUT, '.' + safe.replace(WEB_OUT, ''));
  try {
    const st = await stat(target);
    if (st.isDirectory()) {
      const idx = join(target, 'index.html');
      const buf = await readFile(idx);
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(buf);
      return;
    }
    const buf = await readFile(target);
    res.writeHead(200, { 'content-type': MIME[extname(target)] || 'application/octet-stream' });
    res.end(buf);
    return;
  } catch {
    try {
      const buf = await readFile(join(WEB_OUT, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(buf);
      return;
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Frontend not built. Run: cd web && npm run build');
      return;
    }
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization, x-api-key');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url || '/', 'http://localhost');
  const path = url.pathname;

  try {
    // ---- Public: config (branding + llm status) ----
    if (path === '/api/config' && req.method === 'GET') {
      return sendJson(res, 200, {
        brand: BRAND,
        llmConfigured: llm.isConfigured(),
        tools: Object.keys(TOOLS),
        agents: Object.keys(AGENTS),
        enterprise: true,
      });
    }

    // ---- Public: status ----
    if (path === '/api/status' && req.method === 'GET') {
      return sendJson(res, 200, {
        llmConfigured: llm.isConfigured(),
        tools: Object.keys(TOOLS),
        tokenUsage: llm.usage(),
        session: sessions.list()[0]?.id,
        enterprise: true,
      });
    }

    // ---- Admin-only: stats ----
    if (path === '/api/admin/stats' && req.method === 'GET') {
      const admin = auth.validate(extractToken(req));
      if (!admin?.isAdmin) return sendJson(res, 401, { ok: false, error: 'admin token required' });
      return sendJson(res, 200, { metrics: metrics.snapshot(), tokens: auth.listTokens(), brand: BRAND });
    }

    // ---- Admin-only: create tenant key ----
    if (path === '/api/admin/keys' && req.method === 'POST') {
      const admin = auth.validate(extractToken(req));
      if (!admin?.isAdmin) return sendJson(res, 401, { ok: false, error: 'admin token required' });
      const body = await readJson(req).catch(() => ({}));
      const created = auth.createTenantToken(String(body.label || 'tenant'));
      return sendJson(res, 200, { ok: true, ...created });
    }

    // ---- Protected: tool call ----
    if (path === '/api/tool' && req.method === 'POST') {
      const info = requireAuth(req, res);
      if (!info) return;
      const body = await readJson(req);
      const tool = TOOLS[body.name];
      if (!tool) return sendJson(res, 404, { ok: false, error: `unknown tool: ${body.name}` });
      const before = llm.usage();
      let ok = true;
      let r: Awaited<ReturnType<(typeof TOOLS)[keyof typeof TOOLS]['run']>>;
      try {
        r = await tool.run(body.args || {}, { projectRoot: ROOT });
      } catch (e) {
        ok = false;
        r = { ok: false, error: (e as Error).message };
      }
      metrics.record(info.tenantId, llm.usage() - before, ok);
      return sendJson(res, 200, r);
    }

    // ---- Protected: chat (SSE + function-calling) ----
    if (path === '/api/chat' && req.method === 'POST') {
      const info = requireAuth(req, res);
      if (!info) return;
      const body = await readJson(req);
      const sid = resolveSession(body.sessionId, body.agent);
      const agent = sessions.get(sid)?.agent || 'coordinator';
      const input = String(body.message || '');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      if (!llm.isConfigured()) {
        res.write(`data: ${JSON.stringify({ error: 'LLM not configured (set LLM_API_KEY)' })}\n\n`);
        return res.end();
      }
      const before = llm.usage();
      let ok = true;
      try {
        const history = compactContext([
          { role: 'system', content: SYSTEM_PROMPTS[AGENTS[agent].promptKey] },
          ...ltm.get(sid).map((m) => ({ role: m.role, content: m.content } as ChatMessage)),
          { role: 'user', content: input },
        ] as ChatMessage[]);

        let msgs = history;
        for (let i = 0; i < 5; i++) {
          const r = await llm.chatWithTools(msgs, TOOL_SCHEMA);
          if (r.toolCalls.length === 0) break;
          msgs.push({
            role: 'assistant',
            content: r.content || '',
            tool_calls: r.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })),
          });
          for (const tc of r.toolCalls) {
            let args: Record<string, unknown> = {};
            try {
              args = JSON.parse(tc.arguments || '{}');
            } catch {
              args = {};
            }
            const tool = TOOLS[tc.name];
            const r2 = tool ? await tool.run(args, { projectRoot: ROOT }) : { ok: false, error: `unknown tool: ${tc.name}` };
            res.write(`data: ${JSON.stringify({ tool: tc.name, output: r2.ok ? r2.output ?? '(ok)' : `ERROR: ${r2.error}` })}\n\n`);
            msgs.push({ role: 'tool', tool_call_id: tc.id, content: r2.ok ? r2.output ?? 'ok' : `ERROR: ${r2.error}` });
          }
        }
        let finalText = '';
        for await (const delta of llm.stream(msgs)) {
          finalText += delta;
          res.write(`data: ${JSON.stringify({ delta })}\n\n`);
        }
        ltm.add(sid, 'user', input);
        ltm.add(sid, 'assistant', finalText);
      } catch (e) {
        ok = false;
        res.write(`data: ${JSON.stringify({ error: (e as Error).message })}\n\n`);
      }
      metrics.record(info.tenantId, llm.usage() - before, ok);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    // ---- Admin UI (HTML, client fetches /api/admin/stats with token) ----
    if (path === '/admin' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      return res.end(adminHtml(BRAND.name));
    }

    if (req.method === 'GET') {
      return await serveStatic(req, res);
    }

    return sendJson(res, 404, { ok: false, error: 'Not found' });
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: (e as Error).message });
  }
});

function adminHtml(brandName: string): string {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"/>
<title>${brandName} — Admin</title>
<style>body{font-family:system-ui,sans-serif;margin:0;background:#0f172a;color:#e2e8f0;padding:24px}
h1{font-size:20px}input,button{font:inherit;padding:8px;border-radius:6px;border:1px solid #334155;background:#1e293b;color:#e2e8f0}
button{background:#2563eb;cursor:pointer}.card{background:#1e293b;border:1px solid #334155;border-radius:10px;padding:16px;margin:12px 0}
pre{white-space:pre-wrap;word-break:break-all}</style></head>
<body>
<h1>${brandName} · 企业管理后台</h1>
<div class="card">Admin Token: <input id="tk" placeholder="粘贴 ADMIN_TOKEN" size="40"/> <button onclick="load()">加载</button></div>
<div class="card" id="stats">请输入 admin token 后点击「加载」。</div>
<div class="card">新建租户密钥：<input id="label" placeholder="租户名称"/><button onclick="create()">创建</button> <span id="newkey"></span></div>
<script>
async function load(){const t=document.getElementById('tk').value.trim();if(!t)return;
 const r=await fetch('/api/admin/stats',{headers:{authorization:'Bearer '+t}});const d=await r.json();
 document.getElementById('stats').innerHTML='<pre>'+JSON.stringify(d,null,2)+'</pre>';}
async function create(){const t=document.getElementById('tk').value.trim();const l=document.getElementById('label').value.trim()||'tenant';
 const r=await fetch('/api/admin/keys',{method:'POST',headers:{authorization:'Bearer '+t,'content-type':'application/json'},body:JSON.stringify({label:l})});
 const d=await r.json();document.getElementById('newkey').textContent=d.token?('新密钥: '+d.token):JSON.stringify(d);}
</script></body></html>`;
}

server.listen(PORT, () => {
  console.log(`\n=== ${BRAND.name} — ai-agent-kernel HTTP server ===`);
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`LLM: ${llm.isConfigured() ? 'configured' : 'NOT configured (local mode)'}`);
  console.log(`Enterprise: auth on | admin UI at http://localhost:${PORT}/admin`);
  console.log(`Frontend: ${WEB_OUT} (run "cd web && npm run build" to generate)\n`);
});
