# Project Agents — ai-agent-kernel

## Tech Stack
- Runtime: Node.js 22 + TypeScript (ESM)
- Runner: tsx (dev), tsc (build)
- LLM: OpenAI-compatible endpoint (ChatCompletions), no hard framework dep
- Memory: built-in `node:sqlite` (zero native build)
- Validation: zod

## Conventions
- Functional patterns over classes where practical
- Strict TypeScript (avoid `any`; use `unknown` at boundaries)
- All tools must guard paths + enforce size/timeout limits
- Permission: in-project file rw = SAFE; out-of-project = DANGER; rm/format = DANGER

## Commands
- `npm run dev` / `npm run agent:chat`: launch the agent REPL
- `npm run build`: type-check + emit to dist/
- `npm test`: run tests

## Layout
- src/agent/core: tools / memory / context / permission
- src/agent/brain: llm + query engine / prompts
- src/agent/team: orchestration / sub-agents / sessions
- src/agent/index.ts: REPL entry
