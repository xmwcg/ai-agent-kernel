# 企业 AI Agent 起步包 — 交付清单

## 交付物

| 类别 | 内容 | 验收 |
|------|------|------|
| 代码 | `ai-agent-kernel` 全部源码（MIT） | `npm run build` 通过 |
| 企业层 | `src/agent/enterprise/`（鉴权/多租户/监控） | `/api/admin/stats` 返回用量 |
| 前端 | Next.js 聊天 UI + `/admin` 后台 | 浏览器可聊天、可看用量 |
| 部署 | `Dockerfile` + `docker-compose.yml` | `docker compose up` 起服务 |
| 文档 | `README.md` + `docs/enterprise/*` | 客户可独立照文档部署 |
| 配置 | `.env.example` | 填 key 即运行 |
| 技能 | `ai-agent-fullstack-dev-pro` + `prompt-enhancement-engine`（独立技能包） | 加载即用 |

## 验收标准（Definition of Done）

- [ ] `npm install && npm run build` 无错误
- [ ] `npm run server` 启动，访问 `/api/config` 返回 `enterprise: true`
- [ ] 无 token 调用 `/api/chat` 返回 **401**
- [ ] 管理员 token 调用 `/api/chat` 返回 **200 SSE** 且含 `[DONE]`
- [ ] 管理员可 `POST /api/admin/keys` 创建租户密钥
- [ ] 租户密钥可调 `/api/chat`，但 **不能** 访问 `/api/admin/stats`（401）
- [ ] `/admin` 后台显示用量（请求数 / Token / 成功率）
- [ ] `docker compose up -d` 后服务可访问
- [ ] `.env`（含 key）**未**进入任何提交（gitignored）

## 交付后支持

- 专业版：1 次远程上线支持（≤2 小时）
- 企业定制：季度迭代 + 优先工单 + 专属训练

## 不包含（明确边界）

- 不托管客户 LLM Key（客户自备）
- 默认不做独立数据库实例级多租户（逻辑隔离）
- 默认不含 SSO/OIDC（可选增购）
