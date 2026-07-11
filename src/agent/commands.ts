// P4.4 — Command system: slash commands + direct tool invocation.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOOLS } from './core/tools.js';
import { AGENTS } from './team/agents.js';
import { routeIntent } from './team/graph.js';
import type { LongTermMemory, UserProfileMemory, ShortTermMemory } from './core/memory.js';
import type { SessionManager } from './team/session.js';
import type { QueryEngine } from './brain/llm.js';

export interface CommandContext {
  projectRoot: string;
  llm: QueryEngine;
  ltm: LongTermMemory;
  profile: UserProfileMemory;
  short: ShortTermMemory;
  sessions: SessionManager;
  currentSessionId: () => string;
  setCurrentSession: (id: string) => void;
  currentAgent: () => string;
  setCurrentAgent: (a: string) => void;
}

export interface CommandResult {
  output: string;
  exit?: boolean;
}

function parseKV(s: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const re = /(\w+)\s*=\s*("([^"]*)"|'([^']*)'|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) out[m[1]] = m[3] ?? m[4] ?? m[5];
  return out;
}

function parseArgs(rest: string): Record<string, unknown> {
  const t = rest.trim();
  if (t.startsWith('{')) {
    try {
      return JSON.parse(t);
    } catch {
      return {};
    }
  }
  return parseKV(t);
}

export function handleCommand(line: string, ctx: CommandContext): CommandResult {
  const [cmd, ...restParts] = line.slice(1).split(/\s+/);
  const rest = restParts.join(' ');
  const name = cmd?.toLowerCase() ?? '';

  switch (name) {
    case 'help':
      return {
        output: [
          'Commands:',
          '  /help                 this help',
          '  /status               show kernel status',
          '  /agents               list sub-agents',
          '  /tools                list tools',
          '  /switch <agent>       set active sub-agent',
          '  /route <text>         show which agent would handle text',
          '  /session:create [n]   create + switch session',
          '  /session:list         list sessions',
          '  /history              show current session history',
          '  /export               export current session to JSON',
          '  /memory:stats         show memory stats',
          '  /clear                clear short-term context',
          '  /tool <name> <json>   call a tool directly, e.g. /tool read_file {"path":"MEMORY.md"}',
          '  /exit                 quit',
          '',
          'Free text: if LLM_API_KEY is set, sent to the active agent; else use /tool to call tools.',
        ].join('\n'),
      };

    case 'status':
      return {
        output: [
          `LLM configured : ${ctx.llm.isConfigured() ? 'yes' : 'NO (local tool mode)'}`,
          `Active agent    : ${ctx.currentAgent()}`,
          `Current session : ${ctx.currentSessionId()}`,
          `Token usage     : ${ctx.llm.usage()} (est.)`,
          `Tools available : ${Object.keys(TOOLS).join(', ')}`,
        ].join('\n'),
      };

    case 'agents':
    case 'agent:list':
      return { output: Object.values(AGENTS).map((a) => `  ${a.name.padEnd(12)} ${a.label}  [${a.tools.join(', ')}]`).join('\n') };

    case 'tools':
    case 'tool:list':
      return { output: Object.values(TOOLS).map((t) => `  ${t.name.padEnd(12)} ${t.description}`).join('\n') };

    case 'switch': {
      const a = rest.trim();
      if (!AGENTS[a]) return { output: `Unknown agent: ${a}. Try /agents` };
      ctx.setCurrentAgent(a);
      return { output: `Switched active agent -> ${a}` };
    }

    case 'route': {
      const target = routeIntent(rest);
      return { output: `Would route to: ${target}` };
    }

    case 'session:create': {
      const s = ctx.sessions.create(rest.trim() || 'session', ctx.currentAgent());
      ctx.setCurrentSession(s.id);
      return { output: `Created session ${s.id} (${s.name}) and switched to it.` };
    }

    case 'session:list':
      return { output: ctx.sessions.list().map((s) => `  ${s.id}  ${s.name}  [${s.agent}]`).join('\n') || '(none)' };

    case 'history': {
      const msgs = ctx.ltm.get(ctx.currentSessionId());
      return { output: msgs.map((m) => `[${m.role}] ${m.content}`).join('\n') || '(empty)' };
    }

    case 'export': {
      const data = ctx.sessions.export(ctx.currentSessionId());
      if (!data) return { output: 'No current session.' };
      const file = resolve(ctx.projectRoot, 'data', `export_${data.meta.id}.json`);
      writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
      return { output: `Exported to ${file}` };
    }

    case 'memory:stats': {
      const msgs = ctx.ltm.get(ctx.currentSessionId());
      return { output: `Long-term messages (this session): ${msgs.length}\nProfile keys: ${ctx.profile.keys().length}` };
    }

    case 'clear':
      ctx.short.clear();
      return { output: 'Short-term context cleared.' };

    case 'tool': {
      const [toolName, ...argsParts] = rest.split(/\s+/);
      const tool = TOOLS[toolName];
      if (!tool) return { output: `Unknown tool: ${toolName}. Try /tools` };
      const args = parseArgs(argsParts.join(' '));
      // run synchronously via promise
      return { output: '__ASYNC__' }; // placeholder; handled in index via async wrapper
    }

    case 'exit':
    case 'quit':
      return { output: 'Bye.', exit: true };

    default:
      return { output: `Unknown command: /${name}. Try /help` };
  }
}

// Async wrapper because /tool needs to await the tool.
export async function handleCommandAsync(line: string, ctx: CommandContext): Promise<CommandResult> {
  if (line.trim().startsWith('/tool ')) {
    const rest = line.slice(5).trim();
    const sp = rest.indexOf(' ');
    const toolName = sp === -1 ? rest : rest.slice(0, sp);
    const argStr = sp === -1 ? '' : rest.slice(sp + 1);
    const tool = TOOLS[toolName];
    if (!tool) return { output: `Unknown tool: ${toolName}. Try /tools` };
    const args = parseArgs(argStr);
    const r = await tool.run(args, { projectRoot: ctx.projectRoot });
    return { output: r.ok ? r.output ?? '(ok)' : `ERROR: ${r.error}${r.output ? '\n' + r.output : ''}` };
  }
  return handleCommand(line, ctx);
}
