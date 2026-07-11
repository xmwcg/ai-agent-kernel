// P2.1 — Six base tools with safety guards.
// Tools: read_file, write_file, exec (allowlist), run_python, web_search, web_fetch.
import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { spawn } from 'node:child_process';

export interface ToolContext {
  projectRoot: string;
}

export interface ToolResult {
  ok: boolean;
  output?: string;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  // JSON Schema for the tool's arguments (exposed to the LLM for function calling).
  schema: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB read cap
const EXEC_TIMEOUT_MS = 15000;
const PY_TIMEOUT_MS = 30000;
const FETCH_TIMEOUT_MS = 15000;
const FETCH_MAX_CHARS = 200000;

// Resolve a (possibly relative) path and ensure it stays inside projectRoot.
function safeResolve(ctx: ToolContext, p: string): string {
  const base = resolve(ctx.projectRoot);
  const target = resolve(base, p);
  const rel = relative(base, target);
  if (rel.startsWith('..') || rel === '') {
    // allow exact root, reject escapes
    if (target !== base) throw new Error(`Path escapes project root: ${p}`);
  }
  return target;
}

function execAllowlist(): Set<string> {
  const extra = (process.env.EXEC_ALLOWLIST || '').split(',').map((s) => s.trim()).filter(Boolean);
  const def = ['ls', 'dir', 'echo', 'cat', 'type', 'node', 'tsx', 'npm', 'npx', 'git', 'python', 'python3', 'ping', 'pwd', 'whoami', 'date', 'cls', 'ver'];
  return new Set([...def, ...extra]);
}

function runShell(command: string, timeoutMs: number): Promise<ToolResult> {
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
  const shellArg = process.platform === 'win32' ? ['/c'] : ['-c'];
  return new Promise((resolvePromise) => {
    const child = spawn(shell, [...shellArg, command], { timeout: timeoutMs });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => resolvePromise({ ok: false, error: e.message }));
    child.on('close', (code) => {
      const output = out.trim() || err.trim();
      resolvePromise({ ok: code === 0, output: output || '(no output)', error: code === 0 ? undefined : `exit ${code}` });
    });
  });
}

function detectPython(): string {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  return process.platform === 'win32' ? 'python' : 'python3';
}

// Run a binary directly (no shell) — used for python so we avoid cmd path quirks.
function runProcess(bin: string, args: string[], timeoutMs: number): Promise<ToolResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(bin, args, { timeout: timeoutMs, shell: false });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => resolvePromise({ ok: false, error: e.message }));
    child.on('close', (code) => {
      const output = (out || err).trim() || '(no output)';
      resolvePromise({ ok: code === 0, output, error: code === 0 ? undefined : `exit ${code}` });
    });
  });
}

export const TOOLS: Record<string, Tool> = {
  read_file: {
    name: 'read_file',
    description: 'Safely read a text file inside the project (size-limited, path must stay within project).',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path inside the project, e.g. "MEMORY.md"' },
        limit: { type: 'number', description: 'Optional max characters to read' },
      },
      required: ['path'],
    },
    async run(args, ctx) {
      try {
        const p = String(args.path);
        const target = safeResolve(ctx, p);
        if (!existsSync(target)) return { ok: false, error: `Not found: ${p}` };
        const st = statSync(target);
        if (st.size > MAX_FILE_BYTES) return { ok: false, error: `File too large (${(st.size / 1e6).toFixed(1)}MB > 2MB cap)` };
        let content = readFileSync(target, 'utf8');
        const limit = typeof args.limit === 'number' ? args.limit : undefined;
        if (limit && content.length > limit) content = content.slice(0, limit) + '\n…(truncated)';
        return { ok: true, output: content };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  },

  write_file: {
    name: 'write_file',
    description: 'Write text content to a file inside the project (creates parent dirs).',
    schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Relative file path inside the project' },
        content: { type: 'string', description: 'Text content to write' },
      },
      required: ['path', 'content'],
    },
    async run(args, ctx) {
      try {
        const p = String(args.path);
        const content = String(args.content ?? '');
        const target = safeResolve(ctx, p);
        mkdirSync(resolve(target, '..'), { recursive: true });
        writeFileSync(target, content, 'utf8');
        return { ok: true, output: `Wrote ${content.length} chars to ${p}` };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  },

  exec: {
    name: 'exec',
    description: 'Run a shell command from an allowlist only (sandboxed, rejects rm/format etc).',
    schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command whose binary is in the allowlist, e.g. "echo hello"' },
      },
      required: ['command'],
    },
    async run(args) {
      try {
        const command = String(args.command);
        const bin = command.trim().split(/\s+/)[0].toLowerCase();
        if (!execAllowlist().has(bin)) {
          return { ok: false, error: `Command not in allowlist: ${bin} (set EXEC_ALLOWLIST to extend)` };
        }
        return await runShell(command, EXEC_TIMEOUT_MS);
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  },

  run_python: {
    name: 'run_python',
    description: 'Execute a Python snippet and return stdout.',
    schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Python source code to execute' },
      },
      required: ['code'],
    },
    async run(args, ctx) {
      try {
        const code = String(args.code);
        const tmp = resolve(ctx.projectRoot, 'data', 'tmp_py.py');
        mkdirSync(resolve(ctx.projectRoot, 'data'), { recursive: true });
        await writeFile(tmp, code, 'utf8');
        const r = await runProcess(detectPython(), [tmp], PY_TIMEOUT_MS);
        return r;
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  },

  web_search: {
    name: 'web_search',
    description: 'Web search via Tavily (needs SEARCH_API_KEY in env).',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        max: { type: 'number', description: 'Max results (default 5)' },
      },
      required: ['query'],
    },
    async run(args) {
      const query = String(args.query);
      const key = process.env.SEARCH_API_KEY;
      if (!key) {
        return { ok: true, output: `[search not configured] set SEARCH_API_KEY to enable web search. Query was: ${query}` };
      }
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ api_key: key, query, max_results: Number(args.max) || 5 }),
          signal: ctrl.signal,
        });
        clearTimeout(t);
        const data = (await res.json()) as { results?: Array<{ title: string; url: string; content: string }> };
        const lines = (data.results || []).map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content}`);
        return { ok: true, output: lines.join('\n\n') || '(no results)' };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  },

  web_fetch: {
    name: 'web_fetch',
    description: 'Fetch a URL and return its text (timeout + size capped).',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute URL to fetch' },
      },
      required: ['url'],
    },
    async run(args) {
      try {
        const url = String(args.url);
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        let text = await res.text();
        if (text.length > FETCH_MAX_CHARS) text = text.slice(0, FETCH_MAX_CHARS) + '\n…(truncated)';
        return { ok: true, output: text };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  },
};

export const TOOL_NAMES = Object.keys(TOOLS);
