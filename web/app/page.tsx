'use client';

import { useEffect, useRef, useState } from 'react';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '';

type Role = 'user' | 'assistant' | 'tool';
type Msg = { role: Role; content: string };

const AGENTS = ['coordinator', 'researcher', 'coder', 'writer', 'reviewer'];

export default function Chat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [agent, setAgent] = useState('coordinator');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ llmConfigured?: boolean; tools?: string[] } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    fetch(API_BASE + '/api/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ llmConfigured: false }));
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setBusy(true);
    setMessages((m) => [...m, { role: 'user', content: text }, { role: 'assistant', content: '' }]);
    try {
      const res = await fetch(API_BASE + '/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: text, agent }),
      });
      if (!res.body) throw new Error('no response stream');
      const reader = res.body.getReader();
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
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            if (json.error) {
              setMessages((m) => {
                const c = [...m];
                c[c.length - 1] = { role: 'assistant', content: 'Error: ' + json.error };
                return c;
              });
            } else if (json.tool) {
              setMessages((m) => [...m, { role: 'tool', content: `🔧 ${json.tool}\n${json.output}` }]);
            } else if (json.delta) {
              setMessages((m) => {
                const c = [...m];
                c[c.length - 1] = { role: 'assistant', content: c[c.length - 1].content + json.delta };
                return c;
              });
            }
          } catch {
            /* ignore partial */
          }
        }
      }
    } catch (e: any) {
      setMessages((m) => {
        const c = [...m];
        c[c.length - 1] = { role: 'assistant', content: 'Error: ' + e.message };
        return c;
      });
    }
    setBusy(false);
  }

  return (
    <div id="app">
      <header>
        <h1>AI Agent Kernel</h1>
        <select value={agent} onChange={(e) => setAgent(e.target.value)} disabled={busy}>
          {AGENTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <span className="status">
          {status ? (status.llmConfigured ? 'LLM ✓' : 'LLM ✗ (local)') : '…'}
          {status?.tools ? ` · ${status.tools.length} tools` : ''}
        </span>
      </header>
      <div id="messages">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.content}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <footer>
        <input
          value={input}
          placeholder={busy ? 'thinking…' : 'Message the agent… (try: 用 run_python 计算 2 的 20 次方)'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          disabled={busy}
        />
        <button onClick={send} disabled={busy}>
          Send
        </button>
      </footer>
    </div>
  );
}
