// P2/P4 HTTP server — exposes the kernel over HTTP so a web UI can drive it.
// Zero extra deps: Node's built-in http. Reuses tools/memory/llm/team modules.
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

loadEnv();
const ROOT = process.cwd();
const PORT = Number(process.env.PORT) || 8787;
const WEB_OUT = resolve(ROOT, 'web', 'out'); // Next.js static export dir

const llm = new QueryEngine();
const ltm = new LongTermMemory(ROOT);
const profile = new UserProfileMemory(ROOT);
const short = createShortTerm();
const sessions = new SessionManager(ROOT, ltm);
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
      return res.end(buf);
    }
    const buf = await readFile(target);
    res.writeHead(200, { 'content-type': MIME[extname(target)] || 'application/octet-stream' });
    return res.end(buf);
  } catch {
    // SPA fallback
    try {
      const buf = await readFile(join(WEB_OUT, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] });
      return res.end(buf);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('Frontend not built. Run: cd web && npm run build');
    }
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url || '/', 'http://localhost');
  const path = url.pathname;

  try {
    if (path === '/api/status' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ llmConfigured: llm.isConfigured(), tools: Object.keys(TOOLS), tokenUsage: llm.usage(), session: sessions.list()[0]?.id }));
    }

    if (path === '/api/tool' && req.method === 'POST') {
      const body = await readJson(req);
      const tool = TOOLS[body.name];
      if (!tool) {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: `unknown tool: ${body.name}` }));
      }
      const r = await tool.run(body.args || {}, { projectRoot: ROOT });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(r));
    }

    if (path === '/api/chat' && req.method === 'POST') {
      const body = await readJson(req);
      const sid = resolveSession(body.sessionId, body.agent);
      const agent = sessions.get(sid)?.agent || 'coordinator';
      const input = String(body.message || '');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      if (!llm.isConfigured()) {
        res.write(`data: ${JSON.stringify({ error: 'LLM not configured (set LLM_API_KEY)' })}\n\n`);
        return res.end();
      }
      const history = compactContext([
        { role: 'system', content: SYSTEM_PROMPTS[AGENTS[agent].promptKey] },
        ...ltm.get(sid).map((m) => ({ role: m.role, content: m.content } as ChatMessage)),
        { role: 'user', content: input },
      ] as ChatMessage[]);

      // Function-calling loop (non-stream), then stream the final answer.
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
      // Stream the final answer.
      let finalText = '';
      for await (const delta of llm.stream(msgs)) {
        finalText += delta;
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
      ltm.add(sid, 'user', input);
      ltm.add(sid, 'assistant', finalText);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    if (req.method === 'GET') {
      return await serveStatic(req, res);
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
});

server.listen(PORT, () => {
  console.log(`\n=== ai-agent-kernel HTTP server ===`);
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`LLM: ${llm.isConfigured() ? 'configured' : 'NOT configured (local mode)'}`);
  console.log(`Frontend: ${WEB_OUT} (run "cd web && npm run build" to generate)\n`);
});
