# Project Memory — ai-agent-kernel

## What this is
Minimal runnable AI Agent kernel (MVP) scaffolded from the `ai-agent-fullstack-dev` skill
(phases P1–P4). Implements the 10-capability architecture in trimmed form:
Tools + Memory + Context + Permission + (LLM QueryEngine) + Sub-agent + Sessions + Command.

## Key decisions
- No LangChain: LLM client is a thin OpenAI-compatible fetch wrapper. Rationale: MVP should
  run with zero external API and minimal deps; LangChain is the documented upgrade path.
- Memory uses built-in `node:sqlite` (Node 22) — avoids better-sqlite3 native build.
- LLM is optional: without `LLM_API_KEY` the kernel still runs tools via the REPL.
- Multi-agent uses a lightweight heuristic router (no graph lib) for MVP; LangGraph is the
  documented upgrade path (P4.2).

## Status
- [x] P1 scaffold
- [x] P2.1 six base tools (+ safety)
- [x] P2.2 three-layer memory (node:sqlite)
- [x] P2.3 context budget trim
- [x] P2.4 permission levels
- [x] P3 LLM connect + QueryEngine (retry/limit/track) + fallback
- [x] P4 coordinator router + sessions + commands
- [ ] P5 web frontend / content (not in MVP)
- [ ] P6 deploy (Docker/CI) (not in MVP)
- [ ] P7 feedback loop (not in MVP)
