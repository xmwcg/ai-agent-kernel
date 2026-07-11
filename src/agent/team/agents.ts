// P4.1 — Sub-agent definitions (role, system prompt, allowed tools).
export interface AgentDef {
  name: string;
  label: string;
  promptKey: string;
  tools: string[];
}

export const AGENTS: Record<string, AgentDef> = {
  coordinator: {
    name: 'coordinator',
    label: '协调者',
    promptKey: 'agent',
    tools: ['read_file', 'write_file', 'exec', 'run_python', 'web_search', 'web_fetch'],
  },
  researcher: {
    name: 'researcher',
    label: '研究员',
    promptKey: 'researcher',
    tools: ['web_search', 'web_fetch', 'read_file'],
  },
  coder: {
    name: 'coder',
    label: '程序员',
    promptKey: 'coder',
    tools: ['read_file', 'write_file', 'exec', 'run_python'],
  },
  writer: {
    name: 'writer',
    label: '写手',
    promptKey: 'writer',
    tools: ['read_file', 'write_file', 'web_fetch'],
  },
  reviewer: {
    name: 'reviewer',
    label: '审核员',
    promptKey: 'reviewer',
    tools: ['read_file', 'exec', 'run_python'],
  },
};

export const AGENT_NAMES = Object.keys(AGENTS);
