# Multi-stage build for ai-agent-kernel.
# Builder installs deps + builds the Next.js static frontend into web/out.
# Runtime serves both the API and the static frontend from one process.
FROM node:22-slim AS base
WORKDIR /app

FROM base AS builder
COPY package.json package-lock.json* tsconfig.json ./
RUN npm install
COPY web/package.json web/package-lock.json* ./web/
RUN cd web && npm install
COPY . .
RUN cd web && npm run build

FROM base AS runtime
ENV NODE_ENV=production
ENV NODE_NO_WARNINGS=1
# python3 so the run_python tool works inside the container
RUN apt-get update && apt-get install -y python3 && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/web/out ./web/out
COPY --from=builder /app/.env.example ./.env.example
EXPOSE 8787
CMD ["npx", "tsx", "src/agent/server.ts"]
