// Context pipeline (P2.3): keep the working message list within a token/char budget.
// MVP strategy: trim oldest messages once the budget is exceeded (cheap, deterministic).

// OpenAI-style tool call (used for both sending assistant tool_calls and parsing replies).
export interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

const CHAR_BUDGET = 12000; // ~3k tokens; small on purpose for MVP

export function compactContext(history: ChatMessage[], budget = CHAR_BUDGET): ChatMessage[] {
  let total = history.reduce((n, m) => n + (m.content?.length ?? 0), 0);
  const out = [...history];
  // Drop oldest non-system messages first.
  while (total > budget && out.length > 1) {
    const idx = out.findIndex((m) => m.role !== 'system');
    if (idx === -1) break;
    total -= out[idx].content?.length ?? 0;
    out.splice(idx, 1);
  }
  return out;
}

export function estimateChars(history: ChatMessage[]): number {
  return history.reduce((n, m) => n + (m.content?.length ?? 0), 0);
}
