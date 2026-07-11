// P1/P4 entry — agent REPL. Wires tools + memory + permission + context + LLM + team.
import { createInterface } from 'node:readline';
import { loadEnv } from '../utils/env.js';
import { LongTermMemory, UserProfileMemory, createShortTerm } from './core/memory.js';
import { compactContext, type ChatMessage } from './core/context.js';
import { QueryEngine } from './brain/llm.js';
import type { LlmTool } from './brain/llm.js';
import { SYSTEM_PROMPTS } from './brain/prompts.js';
import { AGENTS } from './team/agents.js';
import { TOOLS } from './core/tools.js';
import { SessionManager } from './team/session.js';
import { handleCommandAsync, type CommandContext } from './commands.js';

// Tool schemas exposed to the LLM for function calling.
const TOOL_SCHEMA: LlmTool[] = Object.values(TOOLS).map((t) => ({
  type: 'function',
  function: { name: t.name, description: t.description, parameters: t.schema },
}));

const ROOT = process.cwd();

async function main(): Promise<void> {
  loadEnv();
  const ltm = new LongTermMemory(ROOT);
  const profile = new UserProfileMemory(ROOT);
  const short = createShortTerm();
  const sessions = new SessionManager(ROOT, ltm);
  const llm = new QueryEngine();

  let currentSessionId = sessions.list()[0]?.id ?? sessions.create('default', 'coordinator').id;
  let currentAgent = sessions.get(currentSessionId)?.agent ?? 'coordinator';

  const ctx: CommandContext = {
    projectRoot: ROOT,
    llm,
    ltm,
    profile,
    short,
    sessions,
    currentSessionId: () => currentSessionId,
    setCurrentSession: (id) => {
      currentSessionId = id;
      currentAgent = sessions.get(id)?.agent ?? 'coordinator';
    },
    currentAgent: () => currentAgent,
    setCurrentAgent: (a) => {
      currentAgent = a;
      sessions.setAgent(currentSessionId, a);
    },
  };

  console.log('\n=== ai-agent-kernel (MVP) ===');
  console.log(`LLM: ${llm.isConfigured() ? 'configured' : 'NOT configured -> local tool mode'}`);
  console.log(`Session: ${currentSessionId} | Agent: ${currentAgent}`);
  console.log('Type /help for commands. Ctrl+C to quit.\n');

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('agent> ');
  rl.prompt();

  for await (const line of rl) {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      continue;
    }

    if (input.startsWith('/')) {
      const res = await handleCommandAsync(input, ctx);
      console.log(res.output);
      if (res.exit) break;
      rl.prompt();
      continue;
    }

    // Free-text: route + (if LLM) chat, else inform.
    if (llm.isConfigured()) {
      const agentDef = AGENTS[currentAgent];
      const history = compactContext([
        { role: 'system', content: SYSTEM_PROMPTS[agentDef.promptKey] },
        ...ltm.get(currentSessionId).map((m) => ({ role: m.role, content: m.content } as ChatMessage)),
        { role: 'user', content: input },
      ] as ChatMessage[]);

      // Function-calling loop: let the model decide tools, execute them, feed results back.
      let finalReply = '';
      const MAX_TOOL_ITER = 5;
      for (let i = 0; i < MAX_TOOL_ITER; i++) {
        const r = await llm.chatWithTools(history, TOOL_SCHEMA);
        if (r.toolCalls.length === 0) {
          finalReply = r.content;
          break;
        }
        history.push({
          role: 'assistant',
          content: r.content || '',
          tool_calls: r.toolCalls.map((tc) => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } })),
        } as ChatMessage);
        for (const tc of r.toolCalls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.arguments || '{}');
          } catch {
            args = {};
          }
          const tool = TOOLS[tc.name];
          const res = tool ? await tool.run(args, { projectRoot: ROOT }) : { ok: false, error: `unknown tool: ${tc.name}` };
          history.push({ role: 'tool', tool_call_id: tc.id, content: res.ok ? res.output ?? '(ok)' : `ERROR: ${res.error}` } as ChatMessage);
        }
      }
      if (!finalReply) finalReply = '(tool loop ended without a final answer)';
      ltm.add(currentSessionId, 'user', input);
      ltm.add(currentSessionId, 'assistant', finalReply);
      short.push('user', input);
      short.push('assistant', finalReply);
      console.log(`\n[${currentAgent}] ${finalReply}\n`);
    } else {
      const target = (await import('./team/graph.js')).routeIntent(input);
      ltm.add(currentSessionId, 'user', input);
      console.log(`\n[no LLM] routed to: ${target}. Use /tool <name> <json> to call tools, or set LLM_API_KEY in .env for chat.\n`);
    }
    rl.prompt();
  }
  rl.close();
  ltm.close();
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
