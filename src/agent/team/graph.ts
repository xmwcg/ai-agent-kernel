// P4.2 — Lightweight coordinator router (heuristic; no graph lib for MVP).
// LangGraph is the documented upgrade path; a deterministic router keeps the MVP runnable.
import { AGENT_NAMES } from './agents.js';

const RULES: Array<{ agent: string; keywords: RegExp }> = [
  { agent: 'researcher', keywords: /\b(搜索|查资料|调研|research|search|找一下|查一下|检索)\b/i },
  { agent: 'coder', keywords: /\b(写代码|实现|debug|修|函数|代码|code|implement|build|编译|跑一下)\b/i },
  { agent: 'writer', keywords: /\b(写文档|文章|ppt|大纲|总结|文案|write|doc|article|outline)\b/i },
  { agent: 'reviewer', keywords: /\b(审查|检查|审计|review|qa|校验|测试)\b/i },
];

export function routeIntent(text: string): string {
  for (const rule of RULES) {
    if (rule.keywords.test(text)) return rule.agent;
  }
  return 'coordinator';
}

export function listAgents(): string[] {
  return AGENT_NAMES;
}
