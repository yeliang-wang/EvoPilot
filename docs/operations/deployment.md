# 部署

## 本地生产近似运行

```bash
EVOPILOT_PORT=19876 \
EVOPILOT_RUN_MODE=prod \
EVOPILOT_DATA_ROOT=data/evopilot \
EVOPILOT_USERS=admin:change-me-admin-password:admin:tenant-production:workspace-agent-products:PlatformAdmin \
EVOPILOT_TOKENS=admin:change-me-admin-token:admin,operator:change-me-operator-token:operator,viewer:change-me-viewer-token:viewer \
npm run server
```

验证 API：

```text
http://127.0.0.1:19876/health
http://127.0.0.1:19876/ready
```

Dashboard 已拆分到独立仓库 `yeliang-wang/evopilot-dashboard`。生产部署建议用反向代理暴露：

```text
/       -> evopilot-dashboard
/api/*  -> evopilot-server:19876
```

短期兼容模式下，可以显式设置 `EVOPILOT_DASHBOARD_ROOT=/path/to/dashboard/dist` 让 EvoPilot server 托管静态 Dashboard；默认生产镜像不再包含 Dashboard 资源。

## 独立 Dashboard 服务

Dashboard 仓库单独构建和部署：

```bash
git clone git@github.com:yeliang-wang/evopilot-dashboard.git
cd evopilot-dashboard
EVOPILOT_DOCKER_NETWORK=evopilot_default \
EVOPILOT_API_BASE_URL=http://evopilot-server:19876 \
EVOPILOT_DASHBOARD_PORT=8080 \
docker compose -f compose.production.yaml up -d --build
```

这个 Compose 文件只启动 `evopilot-dashboard`。它通过 Nginx 暴露 `/` 和 `/health`，并把 `/api/*` 代理到 `EVOPILOT_API_BASE_URL`。在同一台 Linux 服务器上与 EvoPilot API 使用不同 Compose project 部署时，Dashboard 加入 `evopilot_default` 网络，并通过 `evopilot-server:19876` 访问 EvoPilot API。

验收：

```bash
curl -fsS http://127.0.0.1:19876/health
curl -fsS http://127.0.0.1:19876/ready
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/
```

浏览器访问 `http://<host>:8080/`。Dashboard 登录、项目、Loop、GlobalGoal、发布证据和审计页面都必须通过 `/api/*` 访问 EvoPilot，不允许读取服务器文件或数据库。

如果宿主机 Nginx 负责公网 80/443 入口，使用 Dashboard 仓库的 `deploy/nginx/evopilot-dashboard.conf.example` 作为路由模板：`/` 代理到 Dashboard，`/api/*`、`/health`、`/ready` 代理到 EvoPilot API。

Dashboard 页面操作、数字人仿真和 UI 排障文档位于 Dashboard 仓库 `docs/`；本仓只保留 API Server、CLI、运行时和后端部署文档。

## Docker

```bash
docker build -t evopilot:1.0.0 .
docker run --rm \
  -p 19876:19876 \
  -e EVOPILOT_USERS='admin:change-me-admin-password:admin:tenant-production:workspace-agent-products:PlatformAdmin' \
  -e EVOPILOT_TOKENS='admin:change-me-admin-token:admin,operator:change-me-operator-token:operator,viewer:change-me-viewer-token:viewer' \
  -v evopilot-data:/var/lib/evopilot \
  evopilot:1.0.0
```

## Docker Compose

```bash
docker compose up --build
```

Compose 会启动 `evopilot-server`、`evopilot-code-upgrader`、`evopilot-loop-worker` 和 `evopilot-postgres`。Dashboard 作为独立服务部署，不再由 `evopilot-server` 默认托管。生产连续 loop 依赖 worker 常驻进程和可访问的代码升级执行器：

- `evopilot-server` 只负责 API、持久化状态和控制面。
- `evopilot-code-upgrader` 通过 `npm run code-upgrader` 暴露 `/health` 和 `/api/v1/conversations`，在生产模式下会读取 `EVOPILOT_DATA_ROOT/llm.env` 并要求真实 LLM。
- `evopilot-loop-worker` 通过 `/api/v1/loop-workers/claim` 领取可执行 loop，写入 heartbeat lease，再调用 `start` 或 `resume` 推进下一轮。若配置了 `EVOPILOT_LOOP_WORKER_LOOP_ID`，worker 会优先推进该 loop；当该 loop 已完成、不可领取或不存在时，默认回退领取队列中的下一条可执行 loop，避免生产队列被旧 preferred loop 饿死。
- 如果只运行 server，Loop 会停在 `RUNNING / claimable=true / nextAction=claim`，这表示状态可恢复、可领取，但不是后台正在执行。

SaaS 多租户 GA 还要求 Loop Store 使用 Postgres-backed readiness。Compose 默认给 `evopilot-server` 和 `evopilot-loop-worker` 配置：

```text
EVOPILOT_LOOP_STORE_BACKEND=postgres
EVOPILOT_LOOP_STORE_DSN=postgres://evopilot:<password>@evopilot-postgres:5432/evopilot
```

`GET /api/v1/loop-store/readiness` 不只检查环境变量；当 backend 为 `postgres` 时会解析 DSN 并探测 Postgres TCP 端口。只有返回 `status=READY`、`postgresConfigured=true`、`postgresReachable=true` 且 `blockers=[]`，`worker-queue-and-postgres-store` 才能作为 SaaS GA 场景证据。

所有 JSON API 响应都会携带 `meta.llm`，其中包含当前配置的 provider/model、最近一次 LLM 调用、累计 tokens 和 `creditsConsumed`。生产验证时，测试工具应同时检查：

- `meta.llm.configured=true` 且 `provider/model/version` 为预期模型。
- 触发真实 LLM 场景后，`meta.llm.calls > 0`、`meta.llm.totalTokens > 0`、`meta.llm.creditsConsumed > 0`。
- Loop executor step、rule compile、opportunity draft 或 code-upgrader session 中存在具体 `llmTrace`，不能只凭健康检查判断 LLM 有效。

LLM metrics 默认启用。未设置 `EVOPILOT_LLM_METRICS_PATH` 时，只要存在 `EVOPILOT_DATA_ROOT`，EvoPilot 会默认写入 `EVOPILOT_DATA_ROOT/llm-metrics.jsonl`。如果显式设置 `EVOPILOT_LLM_METRICS_PATH` 且它是相对路径，EvoPilot 会把它解析到 `EVOPILOT_DATA_ROOT` 下，便于 server、worker 和 code-upgrader 共享同一份 LLM metrics。

文件态业务数据迁移、Postgres business store 备份和恢复见 [SaaS 生产发布包](../reference/release-package.md)。生产发布前至少执行：

```bash
npm run store:postgres:migrate -- --data-root data/evopilot --dry-run
EVOPILOT_LOOP_STORE_DSN=postgres://evopilot:<password>@127.0.0.1:5432/evopilot \
  npm run store:postgres:backup -- --out backups/evopilot-postgres-business.jsonl
```

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
EVOPILOT_LOOP_WORKER_STRICT_LOOP_ID=1
```

如果未设置 `EVOPILOT_LOOP_WORKER_STRICT_LOOP_ID=1`，`EVOPILOT_LOOP_WORKER_LOOP_ID` 只是优先级提示，不会阻止 worker 消费其他 claimable loop。

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

- Dashboard 面向用户使用用户名/密码登录。服务端会确保存在持久化 bootstrap 平台高级管理员 `admin/admin`，首次登录后必须改密；生产环境也可以额外配置 `EVOPILOT_USERS` 作为用户种子。
- `EVOPILOT_TOKENS` 或 `EVOPILOT_API_TOKEN` 主要用于自动化和兼容 API 调用，不作为最终用户登录方式。
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

## 首次登录与租户账号

1. 打开 Dashboard 登录页，使用 `admin/admin` 登录。
2. 按提示修改默认密码；服务端会拒绝继续使用 `admin/admin` 作为新密码。
3. 进入“租户总览”创建租户和初始工作区。
4. 进入“用户与权限”创建租户管理员，角色为 `admin`，`platformAdmin=false`。
5. 租户管理员再次登录后，只能管理本租户用户、项目、凭据和 Loop。

运行中创建的账号会保存到 `EVOPILOT_DATA_ROOT/users`。如同时配置 `EVOPILOT_USERS`，它们作为启动时用户种子参与登录；持久化用户、环境用户和测试注入用户会合并为同一用户目录，用户名相同时以显式配置优先。

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

主服务和 Loop worker 共用 `schema: evopilot-log/v1`。这个 schema 面向人和值班 AI 共同排障：同一条日志同时保留 HTTP 结果、租户/工作区范围、关联标识、延迟分桶、错误分类和建议动作。WorkBuddy、Codex、Claude Code 等外部 Agent 的生产操作手册见 [AI Agent Runbook](../guides/ai-agent-runbook.md)。

核心字段：

| 字段 | 说明 |
|---|---|
| `schema` | 固定为 `evopilot-log/v1`，便于日志平台和 AI prompt 过滤。 |
| `timestamp` / `level` / `severity` | ISO 时间、程序级别和标准严重级别。 |
| `service` / `version` / `event` / `category` | 服务、版本、事件名和分类。`category` 包括 `http`、`runtime`、`release`、`worker`、`code-upgrade`、`cicd`、`audit`。 |
| `requestId` / `correlation.requestId` | API 响应头 `x-request-id` 对应的请求关联 ID。 |
| `tenantId` / `workspaceId` / `actor` / `role` | 多租户排障范围和操作者角色。 |
| `method` / `path` / `routeGroup` / `statusCode` | HTTP 请求、业务路由分组和响应状态。 |
| `durationMs` / `latencyBucket` | 原始耗时和 `<50ms`、`50-199ms`、`200-999ms`、`1-4s`、`5s+` 分桶。 |
| `outcome` / `errorCode` | `success`、`rejected`、`blocked` 或 `failed`，以及标准化错误码。 |
| `correlation.loopId` / `goalId` / `projectId` / `releaseTargetId` / `releaseDecisionId` / `releaseRunId` | 从请求参数、URL path 或业务上下文提取的故障定位锚点。 |
| `diagnosis.summary` / `likelyCause` / `recommendedAction` | 给 GLM、Codex 或值班工程师读取的诊断摘要、可能原因和下一步动作。 |
| `metadata` | 事件附加信息，已递归脱敏。 |

常用事件：

| event | 用途 |
|---|---|
| `server.started` | 确认进程启动参数、监听地址、运行模式。 |
| `http.request.completed` | 按 `requestId`、路径、状态码、耗时定位 API 请求。 |
| `http.request.failed` | 查看 500 错误、错误栈和请求路径。 |
| `http.request.rejected` | 查看业务阻断，例如审批缺失、权限不足、目标不存在。 |
| `audit.recorded` | 对应持久化审计事件，可按 `action` / `target` 追踪操作。 |
| `code-upgrade.starting` / `code-upgrade.started` / `code-upgrade.status-changed` | 定位代码升级执行器、分支、会话、状态变化。 |
| `project.devops.preflight` | 定位项目 GitHub Actions/GitLab CI provider、executionMode、devopsOwner、workflowRepository、credentialRef、claimBoundary、required checks/jobs 和 health/ready blocker。 |
| `devops.pipeline.triggering` / `devops.pipeline.triggered` | 定位 GitHub Actions/GitLab CI workflow/pipeline、ref、queueId、build URL 和状态。 |
| `loop-worker.*` | 定位独立 Loop worker 的启动、空闲、推进、审批等待和错误。 |

建议生产环境变量：

```text
EVOPILOT_LOG_LEVEL=info
EVOPILOT_LOG_STACK=true
```

排障示例：

```bash
journalctl -u evopilot -o cat | jq 'select(.schema=="evopilot-log/v1" and .correlation.requestId=="<request-id>")'
journalctl -u evopilot -o cat | jq 'select(.schema=="evopilot-log/v1" and .correlation.goalId=="<goal-id>")'
journalctl -u evopilot -o cat | jq 'select(.schema=="evopilot-log/v1" and .outcome=="failed")'
journalctl -u evopilot -o cat | jq 'select(.schema=="evopilot-log/v1" and .tenantId=="<tenant-id>" and .workspaceId=="<workspace-id>")'
journalctl -u evopilot -o cat | jq 'select(.correlation.loopId=="<loop-id>" or .target=="<loop-id>")'
journalctl -u evopilot -o cat | jq 'select(.category=="release" or .correlation.releaseRunId=="<release-run-id>")'
journalctl -u evopilot -o cat | jq 'select(.latencyBucket=="1-4s" or .latencyBucket=="5s+") | {timestamp,event,path,durationMs,latencyBucket,tenantId,workspaceId,errorCode,diagnosis}'
journalctl -u evopilot-worker -o cat | jq 'select(.schema=="evopilot-log/v1" and (.event|startswith("loop-worker.")))'
```

日志会对 `token`、`password`、`secret`、`credential`、`apiKey`、`authorization` 和 Bearer token 做脱敏。连接器密钥和项目凭据不应出现在日志中。

AI 排障建议输入格式：

```text
请基于以下 EvoPilot evopilot-log/v1 日志、trace tree、release decision 和最近部署信息定位故障。
请按 1) 影响范围 2) 直接错误 3) 可能根因 4) 推荐处理动作 5) 需要人工确认的风险 输出。
必须优先使用 correlation.requestId、tenantId、workspaceId、category、outcome、latencyBucket 和 diagnosis 字段，不要基于单条散乱日志下结论。
```

最小日志包建议包含：

- 同一 `correlation.requestId` 的全部日志。
- 同一 `goalId`、`loopId`、`releaseTargetId`、`releaseRunId` 或 `releaseDecisionId` 的 snapshot、trace、release decision 和 audit。
- 最近一次部署或配置变更摘要。
- `/health`、`/ready`、`/api/v1/saas/observability` 的当前结果。
