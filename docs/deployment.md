# 部署

## 本地生产近似运行

```bash
EVOPILOT_PORT=19876 \
EVOPILOT_RUN_MODE=prod \
EVOPILOT_DATA_ROOT=data/evopilot \
EVOPILOT_TOKENS=admin:change-me-admin-token:admin,operator:change-me-operator-token:operator,viewer:change-me-viewer-token:viewer \
npm run server
```

打开：

```text
http://127.0.0.1:19876/
```

## Docker

```bash
docker build -t evopilot:1.0.0 .
docker run --rm \
  -p 19876:19876 \
  -e EVOPILOT_TOKENS='admin:change-me-admin-token:admin,operator:change-me-operator-token:operator,viewer:change-me-viewer-token:viewer' \
  -v evopilot-data:/var/lib/evopilot \
  evopilot:1.0.0
```

## Docker Compose

```bash
docker compose up --build
```

Compose 会同时启动 `evopilot-server` 和 `evopilot-loop-worker`。生产连续 loop 依赖 worker 常驻进程：

- `evopilot-server` 只负责 API、Dashboard、持久化状态和控制面。
- `evopilot-loop-worker` 通过 `/api/v1/loop-workers/claim` 领取可执行 loop，写入 heartbeat lease，再调用 `start` 或 `resume` 推进下一轮。
- 如果只运行 server，Loop 会停在 `RUNNING / claimable=true / nextAction=claim`，这表示状态可恢复、可领取，但不是后台正在执行。

常用 worker 环境变量：

```text
EVOPILOT_BASE_URL=http://evopilot-server:19876
EVOPILOT_API_TOKEN=<operator-or-admin-token>
EVOPILOT_LOOP_WORKER_ID=evopilot-prod-worker
EVOPILOT_LOOP_WORKER_POLL_MS=5000
EVOPILOT_LOOP_WORKER_LEASE_SECONDS=120
```

如需让 worker 只推进某个主 loop，可设置：

```text
EVOPILOT_LOOP_WORKER_LOOP_ID=target-tenant-workspace-model-1783071349806
```

## 生产控制面接入 EvoPilot 自身

生产服务器上的 EvoPilot 可以把 EvoPilot 仓库注册成受治理 target，并创建第一条受控 self-loop。推荐使用远程 GitHub/GitLab 仓库，而不是操作者本机的 `local-git` 路径；`local-git` 验证发生在服务器端，只能验证服务器本地存在的 checkout。

以 GitHub 为例，先在生产服务环境中配置 `GITHUB_TOKEN`，再从任意可访问生产控制面的机器执行：

```bash
EVOPILOT_BASE_URL=https://evopilot.example.com \
EVOPILOT_API_TOKEN=<admin-token> \
EVOPILOT_SELF_REPOSITORY_PROVIDER=github \
EVOPILOT_SELF_GITHUB_OWNER=yeliang-wang \
EVOPILOT_SELF_GITHUB_REPO=EvoPilot \
EVOPILOT_SELF_GITHUB_TOKEN_REF=GITHUB_TOKEN \
npm run self-loop
```

如需启动一轮 Loop Runtime 迭代，显式增加：

```bash
EVOPILOT_SELF_LOOP_START=1
```

该入口只创建 target、evidence 和 loop，或在显式开启时推进一轮 runtime iteration；不会自动修改代码、merge、tag、push 或发布 GA 结论。

## 运行模式

EvoPilot 默认按生产模式启动：

```text
EVOPILOT_RUN_MODE=prod
```

生产模式要求：

- 必须配置 `EVOPILOT_TOKENS` 或 `EVOPILOT_API_TOKEN`。
- `EVOPILOT_REQUIRE_LLM` 默认等于 `true`，必须配置真实 LLM provider；缺少 `EVOPILOT_LLM_BASE_URL`、`EVOPILOT_LLM_MODEL_NAME` 或 `EVOPILOT_LLM_API_KEY` 时，生产服务会拒绝启动并返回 `EVOPILOT_PROD_REQUIRES_LLM_PROVIDER`。
- Loop Runtime 的 `llm` executor 会调用真实 LLM Gateway，成功后把 `provider`、`model`、`totalTokens`、`costUsd` 写入 executor output、evidence 和 trace；调用失败时节点失败，不允许在生产模式下空跑成功。
- 不允许无鉴权 admin。
- 不允许模拟集成链路。
- 不自动注册内置项目画像。
- 不开放样例评测集。

本地调试必须显式打开：

```bash
npm run server:debug
```

调试模式下才允许样例数据、模板兜底和本地模拟集成链路，便于单元测试、冒烟测试和 Dashboard 原型验证。

## RBAC

角色：

| 角色 | 能力 |
|---|---|
| `viewer` | 读取汇总、项目、运行、画像和审计。 |
| `operator` | 拥有 viewer 能力，并可创建演进运行、提交评审决策。 |
| `admin` | 拥有 operator 能力，并可注册项目、执行交付。 |

## 幂等性

生产客户端应为 `POST /api/v1/runs` 设置 `X-Idempotency-Key`。

使用相同 key 重复请求时，服务端会返回第一次的响应，不会创建重复运行。

## 生产日志

EvoPilot V1.0.0 的主服务、Loop worker 和 soak 脚本都输出 JSON Lines，适合直接被 `systemd journal`、Docker/Kubernetes stdout、Loki、ELK 或云日志采集。

主服务每条日志包含：

- `timestamp`
- `level`
- `service`
- `version`
- `event`
- `requestId`
- `method`
- `path`
- `statusCode`
- `durationMs`
- `actor`
- `action`
- `target`
- `metadata`

常用事件：

| event | 用途 |
|---|---|
| `server.started` | 确认进程启动参数、监听地址、运行模式。 |
| `http.request.completed` | 按 `requestId`、路径、状态码、耗时定位 API 请求。 |
| `http.request.failed` | 查看 500 错误、错误栈和请求路径。 |
| `http.request.rejected` | 查看业务阻断，例如审批缺失、权限不足、目标不存在。 |
| `audit.recorded` | 对应持久化审计事件，可按 `action` / `target` 追踪操作。 |
| `code-upgrade.starting` / `code-upgrade.started` / `code-upgrade.status-changed` | 定位代码升级执行器、分支、会话、状态变化。 |
| `jenkins.build.triggering` / `jenkins.build.triggered` | 定位 CI/CD Job、Queue、Build URL。 |
| `loop-worker.*` | 定位独立 Loop worker 的启动、空闲、推进、审批等待和错误。 |

建议生产环境变量：

```text
EVOPILOT_LOG_LEVEL=info
EVOPILOT_LOG_STACK=true
```

排障示例：

```bash
journalctl -u evopilot -o cat | jq 'select(.requestId=="<request-id>")'
journalctl -u evopilot -o cat | jq 'select(.event=="http.request.failed")'
journalctl -u evopilot -o cat | jq 'select(.metadata.loopId=="<loop-id>" or .target=="<loop-id>")'
journalctl -u evopilot-worker -o cat | jq 'select(.event|startswith("loop-worker."))'
```

日志会对 `token`、`password`、`secret`、`credential`、`apiKey`、`authorization` 和 Bearer token 做脱敏。连接器密钥和项目凭据不应出现在日志中。
