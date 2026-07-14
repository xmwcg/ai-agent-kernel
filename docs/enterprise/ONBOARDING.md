# 企业 AI Agent 起步包 — 客户上手指南

## 一、准备

1. 一台能运行 Docker 的服务器（2C4G 起，建议 4C8G）。
2. 一个 OpenAI 兼容的 LLM 端点与 Key（如腾讯 TokenHub、DeepSeek、OpenAI）。
3. （可选）企业名称 / Logo 用于品牌化。

## 二、一键部署

```bash
# 1. 取代码
git clone <your-repo> ai-agent-kernel && cd ai-agent-kernel

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env：填 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL
# 设一个强 ADMIN_TOKEN（生产必填）

# 3. 启动
docker compose up -d

# 4. 验证
curl http://localhost:8787/api/config   # 应返回 enterprise: true
```

打开浏览器 `http://localhost:8787` 即可使用聊天界面。

## 三、创建租户（给团队/客户开账号）

1. 打开 `http://localhost:8787/admin`，用 `ADMIN_TOKEN` 登录。
2. 在「新建租户密钥」输入租户名，点击创建，得到一串 token。
3. 把该 token 发给团队：调用 API 时带 `Authorization: Bearer <token>` 即可。

## 四、调用 API

```bash
# 聊天（SSE 流式）
curl -N -X POST http://localhost:8787/api/chat \
  -H "Authorization: Bearer <token>" \
  -H "content-type: application/json" \
  -d '{"message":"用 run_python 计算 2 的 10 次方","agent":"coordinator"}'

# 直接调工具
curl -X POST http://localhost:8787/api/tool \
  -H "Authorization: Bearer <token>" \
  -H "content-type: application/json" \
  -d '{"name":"run_python","args":{"code":"print(2**10)"}}'
```

## 五、前端使用

- 浏览器打开 `http://localhost:8787`：直接对话，顶部切换子智能体（coder/researcher/...）。
- 模型会**自动**调用工具（function-calling），无需手动。

## 六、查看用量

- 管理员打开 `/admin` → 查看总请求数、Token 消耗、成功率、各租户明细。

## 七、常见问题

| 问题 | 处理 |
|------|------|
| 聊天返回 401 | 请求未带 token，或 token 无效 |
| 聊天无回复 | LLM key 失效/额度不足；看 `/api/status` 的 `llmConfigured` |
| 模型只"描述"工具不执行 | 这是模型退化；用 `prompt-enhancement-engine` 先增强需求，或清会话重来 |
| 想换模型 | 改 `.env` 的 `LLM_MODEL` 重启 |

## 八、升级 / 定制

- 行业技能封装、SSO、专属训练：联系交付方按 `PRICING.md` 增购。
- 自研技能：放在 `src/agent/skills/` 或直接封装本地 WorkBuddy 技能。
