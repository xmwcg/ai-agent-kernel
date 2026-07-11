// P3 — LLM client (OpenAI-compatible) + QueryEngine (retry / rate-limit / token tracking).
// No framework dependency: a thin fetch wrapper. Falls back gracefully when no API key.
import type { ChatMessage } from '../core/context.js';

export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

// OpenAI-style tool declaration passed in the request body.
export interface LlmTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

// A tool call requested by the model.
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatResult {
  content: string;
  toolCalls: ToolCall[];
}

export class QueryEngine {
  private cfg: LlmConfig;
  private dailyTokens = 0;
  private lastCall = 0;
  private minIntervalMs = 250; // simple rate limit
  private maxRetries = 3;

  constructor() {
    this.cfg = {
      apiKey: process.env.LLM_API_KEY || '',
      baseUrl: (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
    };
  }

  isConfigured(): boolean {
    return !!this.cfg.apiKey && this.cfg.apiKey !== 'your_key_here';
  }

  private async rateLimit(): Promise<void> {
    const wait = this.minIntervalMs - (Date.now() - this.lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastCall = Date.now();
  }

  private async backoff(attempt: number): Promise<void> {
    if (attempt > 0) await new Promise((r) => setTimeout(r, Math.min(8000, 2 ** attempt * 500)));
  }

  private track(text: string): void {
    this.dailyTokens += Math.ceil(text.length / 4);
  }

  usage(): number {
    return this.dailyTokens;
  }

  // Plain chat (no tools). Kept for compatibility.
  async chat(messages: ChatMessage[], maxRetries = this.maxRetries): Promise<string> {
    return (await this._request(messages, undefined, maxRetries)).content;
  }

  // Chat with function-calling. Returns content plus any tool calls the model requested.
  async chatWithTools(messages: ChatMessage[], tools?: LlmTool[], maxRetries = this.maxRetries): Promise<ChatResult> {
    return this._request(messages, tools, maxRetries);
  }

  // Core request with retry + backoff. Handles both plain and tool-calling modes.
  private async _request(messages: ChatMessage[], tools: LlmTool[] | undefined, maxRetries: number): Promise<ChatResult> {
    if (!this.isConfigured()) throw new Error('LLM not configured (set LLM_API_KEY).');
    let lastErr = '';
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.rateLimit();
        const body: Record<string, unknown> = { model: this.cfg.model, messages, stream: false };
        if (tools && tools.length) body.tools = tools;
        const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`;
          if (res.status === 429) {
            await this.backoff(attempt + 1);
            continue;
          }
          const txt = await res.text().catch(() => '');
          throw new Error(`${lastErr} ${txt.slice(0, 300)}`);
        }
        const data = (await res.json()) as {
          choices?: Array<{
            message?: {
              content?: string | null;
              tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
            };
          }>;
        };
        const msg = data.choices?.[0]?.message ?? {};
        const content = msg.content ?? '';
        const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        }));
        this.track(content + toolCalls.map((t) => t.arguments).join(''));
        return { content, toolCalls };
      } catch (e) {
        lastErr = (e as Error).message;
        await this.backoff(attempt + 1);
      }
    }
    throw new Error(`LLM request failed after retries: ${lastErr}`);
  }

  // Streaming variant (SSE). Yields text chunks. No tool-calling in stream mode for MVP.
  async *stream(messages: ChatMessage[]): AsyncGenerator<string> {
    if (!this.isConfigured()) throw new Error('LLM not configured (set LLM_API_KEY).');
    await this.rateLimit();
    const res = await fetch(`${this.cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({ model: this.cfg.model, messages, stream: true }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() || '';
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        const payload = s.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const json = JSON.parse(payload) as { choices?: Array<{ delta?: { content?: string } }> };
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            this.track(delta);
            yield delta;
          }
        } catch {
          /* ignore partial */
        }
      }
    }
  }
}
