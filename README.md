# ai-agent-kernel

最小可运行的 AI Agent 内核（按 `ai-agent-fullstack-dev` 技能 7 阶段 MVP 落地）。

- **P1–P4**：项目脚手架 / 6 个基础工具 + 安全护栏 / 3 层记忆（node:sqlite）/ LLM 查询引擎（重试·限流·计费）/ 多智能体路由 + 会话 + 命令系统
- **P3.5**：function-calling —— LLM 自主决策调用工具（read_file / write_file / exec / run_python / web_search / web_fetch）
- **P5**：Next.js 聊天前端（静态导出，由内核 HTTP server 同源 serve）
- **P6**：Docker 容器化（单进程同时提供 API 与前端）

## 配置

复制 `.env.example` 为 `.env`，填入你的 OpenAI 兼容端点：

```
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://tokenhub.tencentmaas.com/v1   # 任意 OpenAI 兼容端点
LLM_MODEL=hy3
```

> 无 key 时内核降级为本地工具模式（REPL 仍可跑工具，只是不能对话）。

## 运行（开发）

```bash
npm install

# 终端 1：内核 HTTP server（API + 前端静态），默认端口 8787
npm run server
# 浏览器打开 http://localhost:8787

# 终端 2（可选）：Next.js 热更新前端（开发态）
npm run web
```

CLI（REPL）模式：

```bash
npm run repl
```

## Docker

```bash
docker build -t ai-agent-kernel .
docker run -p 8787:8787 \
  -e LLM_API_KEY=sk-xxx \
  -e LLM_BASE_URL=https://tokenhub.tencentmaas.com/v1 \
  -e LLM_MODEL=hy3 \
  ai-agent-kernel
# 打开 http://localhost:8787
```

容器内含 python3，因此 `run_python` 工具在容器内可用。

## 企业部署（Enterprise）

内核已含企业层：**轻量鉴权（管理员令牌 + 租户 API Key，逻辑隔离）、用量监控、管理后台 `/admin`、品牌化配置**。

### 一键部署

```bash
cp .env.example .env        # 填 LLM_API_KEY / ADMIN_TOKEN（生产必填）
docker compose up -d       # API + 前端同源单进程，端口 8787
# 打开 http://localhost:8787
```

### 关键环境变量

| 变量 | 说明 |
|------|------|
| `ADMIN_TOKEN` | 管理员令牌；留空则启动时自动生成（控制台打印），生产务必固定 |
| `ENTERPRISE_NAME` | 企业名称（前端/后台展示） |
| `ENTERPRISE_LOGO` | 企业 Logo URL（可选） |

### 鉴权模型

- `/api/chat`、`/api/tool` 需携带 `Authorization: Bearer <token>`（管理员或租户密钥）。
- `/api/admin/*` 仅管理员令牌可访问。
- 管理员在 `/admin` 页面为团队/客户创建租户密钥（逻辑多租户隔离）。

### 监控

- 管理员后台 `/admin` 查看：总请求数、Token 消耗、成功率、各租户明细。
- 用量数据来自 LLM token 追踪（见 `src/agent/brain/llm.ts` + `src/agent/enterprise/auth.ts`）。

### 企业文档

- 产品说明：`docs/enterprise/PRODUCT.md`
- 定价方案：`docs/enterprise/PRICING.md`
- 交付清单：`docs/enterprise/DELIVERY.md`
- 客户上手：`docs/enterprise/ONBOARDING.md`

## REPL 命令

`/help` `/status` `/tools` `/tool <name> <json>` `/route <text>` `/switch <agent>`
`/session:create <name>` `/history` `/export` `/exit`

## 子智能体

`coordinator` · `researcher` · `coder` · `writer` · `reviewer`（用 `/switch` 切换）
