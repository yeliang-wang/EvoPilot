# EvoPilot API

## LLM 调用与 Credits 观测

所有 JSON API 响应都会附带 `meta.llm`，用于让 Dashboard、WorkBuddy、E2E 测试工具判断当前生产环境是否真的发生过 LLM 调用：

```json
{
  "data": {},
  "meta": {
    "llm": {
      "schema": "evopilot-llm-usage-meta/v1",
      "configured": true,
      "provider": "zhipu",
      "model": "glm-5.1",
      "version": "glm-5.1",
      "calls": 1,
      "succeeded": 1,
      "failed": 0,
      "totalTokens": 1024,
      "inputTokens": 768,
      "outputTokens": 256,
      "creditsConsumed": 1024,
      "creditUnit": "token",
      "latest": {
        "requestId": "llm-request-id",
        "caller": "evopilot-loop-runtime",
        "intent": "plan.generation",
        "provider": "zhipu",
        "model": "glm-5.1",
        "version": "glm-5.1",
        "totalTokens": 1024,
        "creditsConsumed": 1024,
        "status": "SUCCEEDED"
      }
    }
  }
}
```

`creditsConsumed` 当前按 `1 token = 1 LLM credit` 计量，`creditUnit` 固定为 `token`。如果 `calls=0` 或 `totalTokens=0`，只能证明 LLM 已配置，不能证明当前场景真的调用了 LLM。具体执行点还会在 `llmTrace`、Loop executor step output/evidence、code-upgrader session 中记录 `provider`、`model/version`、`usage` 和 `creditsConsumed`。

## 健康检查

```http
GET /health
```

返回服务状态、当前项目画像、数据目录，以及 API 是否需要鉴权。

## 鉴权

Dashboard 用户应通过独立登录页输入用户名和密码。服务端启动时会确保存在一个持久化平台高级管理员账号：

```text
username: admin
password: admin
platformAdmin: true
mustChangePassword: true
```

该账号用于首次初始化，登录后必须调用改密接口，不能在生产环境长期使用默认密码。EvoPilot 不提供公网自助注册接口；账号开通遵循 `平台高级管理员 -> 租户管理员 -> 租户内用户`：平台高级管理员创建租户、工作区和租户管理员，租户管理员通过用户管理接口创建本租户用户。未登录用户只能访问登录页、公开帮助和健康检查，不能创建租户、创建用户、接入项目或读取租户数据。也可以使用 `EVOPILOT_USERS` 预置租户用户：

```text
EVOPILOT_USERS=tenant-admin:<password>:admin:tenant-production:workspace-agent-products:Tenant Admin
```

登录成功后，后端返回会话 token 和用户身份：

```http
POST /api/v1/auth/login
Content-Type: application/json

{"username":"tenant-admin","password":"<password>"}
```

首次登录默认管理员后改密：

```http
POST /api/v1/auth/change-password
Authorization: Bearer <session-token>
Content-Type: application/json

{"currentPassword":"admin","newPassword":"<new-password>"}
```

改密成功后响应会同时返回更新后的用户信息和新的会话 token。前端应替换本地 token 后再继续读取控制台数据；旧 token 会因为密码哈希变化而失效。

自动化脚本、CLI 或 Dashboard 登录后的后续请求使用 Bearer token：

```text
Authorization: Bearer <token>
```

`/health` 和控制台静态文件保持公开，用于健康探测和本地查看。

也可以通过 `EVOPILOT_TOKENS` 配置多角色机器 Token：

```text
admin:<token>:admin,operator:<token>:operator,viewer:<token>:viewer
```

角色能力：

- `viewer`：只读访问 API。
- `operator`：创建演进运行，提交评审决策。
- `admin`：注册项目，执行交付。
- `platformAdmin=true`：跨租户创建租户、工作区和租户用户；默认 bootstrap `admin/admin` 属于该类。

多租户 SaaS 请求可以通过 header 指定操作边界：

```text
X-EvoPilot-Tenant: <tenant-id>
X-EvoPilot-Workspace: <workspace-id>
X-EvoPilot-Actor: <member-id>
```

未指定时，服务端使用单租户兼容默认值 `tenant-production` 和 `workspace-agent-products`。普通 viewer/operator 只能访问自己 tenant/workspace 内的数据；租户管理员只能管理本租户用户；`platformAdmin=true` 的平台高级管理员可跨租户执行开通、用户管理和审计动作。项目、Loop、secret、GitHub App installation、release evidence 和 release decision 均带 `tenantId`、`workspaceId`。

## 汇总

```http
GET /api/v1/summary
```

返回项目数、运行数、机会点数、评审数量、发布数量、发布健康度和近期运行记录。

## SaaS 控制面

```http
GET /api/v1/tenants
POST /api/v1/tenants
GET /api/v1/workspaces
POST /api/v1/workspaces
GET /api/v1/users
POST /api/v1/users
PATCH /api/v1/users/{userId}
POST /api/v1/users/{userId}/reset-password
GET /api/v1/workspaces/{workspaceId}
POST /api/v1/workspaces/{workspaceId}/invitations
PATCH /api/v1/workspaces/{workspaceId}/members/{memberId}
GET /api/v1/workspaces/{workspaceId}/usage
GET /api/v1/secrets
POST /api/v1/secrets
POST /api/v1/secrets/{secretId}/revoke
GET /api/v1/github-app/installations
POST /api/v1/github-app/installations
GET /api/v1/loop-store/readiness
GET /api/v1/saas/observability
```

`POST /api/v1/workspaces` 会优先使用请求体中的 `id` 或 `workspaceId` 作为持久化 workspace id；`name` 仅作为展示名称。`GET /api/v1/workspaces/{workspaceId}` 和 `GET /api/v1/workspaces/{workspaceId}/usage` 返回 workspace 详情和 workspace 级项目数、Loop 数、evidence 容量配额；超过项目或 Loop 配额时，创建接口返回 `429 WORKSPACE_PROJECT_QUOTA_EXCEEDED` 或 `429 WORKSPACE_LOOP_QUOTA_EXCEEDED`。为兼容历史数据，详情和 usage 查询会尝试解析旧 name/slug，但新集成应始终使用创建接口返回的 `data.id`。

用户管理接口用于 Dashboard “用户与权限”页。`POST /api/v1/users` 由平台高级管理员或租户管理员调用；平台高级管理员可指定任意 tenant/workspace 并创建 `platformAdmin`，租户管理员只能创建本租户用户且不能授予 `platformAdmin`。`PATCH /api/v1/users/{userId}` 支持修改 displayName、role、tenantId、workspaceId、status、mustChangePassword；`POST /api/v1/users/{userId}/reset-password` 会写入新密码哈希并把 `mustChangePassword` 置为 `true`。所有响应都会隐藏 `passwordHash`。

`POST /api/v1/secrets` 只返回 `secretRef` 和 `valueConfigured`，不会回显明文或加密 payload。GitHub App installation readiness 会验证 private key secret、webhook secret、repository selection 和 least-privilege permissions，并且 secret ref 必须属于同一 tenant/workspace 且类型正确。

`GET /api/v1/loop-store/readiness` 返回 `evopilot-loop-store-readiness/v1`。SaaS GA 要求 Postgres-backed loop store；未配置 `EVOPILOT_LOOP_STORE_BACKEND=postgres` 和 DSN 时返回 `BLOCKED / POSTGRES_LOOP_STORE_NOT_CONFIGURED`。

`GET /api/v1/saas/observability` 返回 `evopilot-saas-observability/v1`，从真实 store 汇总 tenants、workspaces、projects、loops、secret refs、GitHub App readiness、worker queue、quota blockers、credential blockers 和 Postgres readiness。`GET /api/v1/metrics` 同时暴露 `evopilot_saas_*` Prometheus 指标。

## 项目画像

```http
GET /api/v1/profiles
```

返回已加载的项目画像。当前 MVP 内置 `domainforge-fabric`。

## 触发规则

```http
GET /api/v1/rules
```

返回 Dashboard 用户视角的自然语言规则，例如“所有链路调用小于 3 秒”。接口不会暴露完整结构化执行条件。

EvoPilot 会把用户规则编译为管理员可审查的 Markdown 执行规则，默认存放在：

```text
<EVOPILOT_DATA_ROOT>/rules/*.md
```

Markdown 中包含用户规则、管理员说明和 `json` 代码块。系统运行时从该代码块读取执行规则，例如把“所有链路调用小于 3 秒”编译为 `durationMs`、`latencyMs` 或 `p95LatencyMs` 大于 `3000` 时触发性能热点演进机会。

生产模式下，`POST /api/v1/rules/compile` 必须调用真实 LLM，且返回规则必须通过语义校验后才会写入 Markdown。校验失败时接口返回错误，不会落盘半成品规则。读取规则时，系统会合并内置默认规则和已落盘用户规则；同 ID 的有效用户规则会覆盖默认规则，无效 Markdown 规则会被跳过。

当前可执行规则字段：

| 字段 | 用途 |
|---|---|
| `type` | 事件类型，例如 `performance.latency`、`eval.failed`、`security.leak`。 |
| `source` | 证据来源，例如 `agent`、`observability`、`ci`、`user`。 |
| `severity` | 严重级别。 |
| `module` | 发生问题的模块。 |
| `attributes.durationMs` / `attributes.latencyMs` / `attributes.p95LatencyMs` | 链路、工具或端到端耗时。 |
| `attributes.costUsd` / `attributes.totalTokens` | LLM 或工具调用成本。 |
| `attributes.ragHit` | RAG 是否命中。 |
| `attributes.score` | 评测或语义质量得分。 |
| `attributes.errorRate` | 错误率。 |
| `attributes.rollbackCount` | 回滚次数。 |
| `attributes.contextTruncated` | 上下文是否被截断或高风险压缩。 |

即使没有用户自定义规则，EvoPilot 仍会启用系统默认自进化规则，覆盖延迟、工具失败、产品缺口、成本、RAG、评测回归、负反馈、安全、发布回滚和上下文治理等主流 AI Agent 生产信号。

## 项目

```http
GET /api/v1/projects
POST /api/v1/projects
```

注册接入 EvoPilot 的 AI Agent 产品。项目必须携带 Git 仓库注册信息并通过连接验证后才会落盘；未验证项目不能进入后续证据策略、机会点和流水线流程。

当前支持的仓库接入方式：

- `local-git`：本地 Git/代码目录，必须提供 `repository.root`。
- `gitlab`：GitLab 项目，提供 `repository.gitUrl`，或提供 `repository.baseUrl` + `repository.projectId`。
- `github`：GitHub 仓库，提供 `repository.gitUrl`，或提供 `repository.owner` + `repository.repo`。

凭据支持：

- `username`
- `password`
- `token`
- `tokenRef`，从 EvoPilot 服务环境变量读取真实 token

读取项目列表时不会回显 `password` 或 `token`，只返回 `credentialsConfigured`、`credentialMode`、`tokenRef` 和 `tokenRefResolved` 等非 secret 状态。

公开 GitHub 仓库可以在无凭据时完成只读项目验证；但源码写回、PR/MR、merge 和一键自动驾驶 source-closure 必须配置可解析的 `token`、`password` 或 `tokenRef`。项目级源码写回凭据控制面用于区分 `READ_ONLY` 和 `READY`，Dashboard 的“配置凭据”表单可让用户绑定服务端 `tokenRef` 或填写 inline token，写回前还可调用 loop source-closure preflight，避免在真实写文件阶段才失败。

```http
POST /api/v1/projects/{projectId}/source-credentials
GET /api/v1/projects/{projectId}/source-credentials/preflight
POST /api/v1/projects/{projectId}/source-credentials/preflight
```

`source-credentials` 只更新项目级 GitHub/GitLab 写回凭据元数据，例如 `tokenRef`、`token`、`password`、`username` 或 `defaultBranch`，响应不会回显 secret。`source-credentials/preflight` 不写仓库，只检查项目、provider、credential ref、token 解析、source branch 和写回策略。响应 schema 为 `evopilot-source-credential-readiness/v1`，状态为 `READY`、`READ_ONLY` 或 `BLOCKED`。公开 GitHub 无 token 时通常是 `READ_ONLY`，blocker 为 `token-resolution:SOURCE_CREDENTIAL_TOKEN_REQUIRED`；`tokenRef` 已配置但环境变量未解析时仍为 `READ_ONLY`；解析成功并能读取分支后为 `READY`。Dashboard 保存凭据后会立即调用同一 readiness contract，因此用户补齐凭据后可以回到 Target Loop Backlog 继续 autopilot。

项目 DevOps 绑定使用仓库原生 CI/CD。GitHub 项目绑定 GitHub Actions，GitLab 项目绑定 GitLab CI：

```http
GET /api/v1/projects/{projectId}/devops
POST /api/v1/projects/{projectId}/devops
PUT /api/v1/projects/{projectId}/devops
DELETE /api/v1/projects/{projectId}/devops
GET /api/v1/projects/{projectId}/devops/preflight
POST /api/v1/projects/{projectId}/devops/preflight
```

`devops` 是项目聚合的一部分。`provider=github-actions` 只能用于 GitHub 项目；`provider=gitlab-ci` 只能用于 GitLab 项目。EvoPilot 使用项目 source credentials 或 `devops.tokenRef` 解析平台 token，响应不回显 secret。`devops/preflight` 返回 `evopilot-project-devops-readiness/v1`，状态为：

- `READY`：provider、token、CI 合同和可选 health/ready 探测均可用。
- `OBSERVABLE`：配置和 token 可用，但当前 CI evidence 不是绿色；不能据此声明发布就绪。
- `BLOCKED`：provider mismatch、token 缺失、CI 合同缺失或项目绑定错误。

GitHub Actions 请求示例：

```json
{
  "provider": "github-actions",
  "ci": {
    "workflow": "ci.yml",
    "requiredChecks": ["build", "test"],
    "timeoutSeconds": 1800
  },
  "cd": {
    "workflow": "deploy-prod.yml",
    "environment": "production",
    "healthUrl": "https://my-agent.example.com/health",
    "timeoutSeconds": 1800
  }
}
```

GitLab CI 请求示例：

```json
{
  "provider": "gitlab-ci",
  "ci": {
    "requiredStages": ["test"],
    "requiredJobs": ["build"]
  },
  "cd": {
    "environment": "production",
    "requiredStages": ["deploy"],
    "readyUrl": "https://my-agent.example.com/ready"
  }
}
```

请求示例：

```json
{
  "id": "agent-prod",
  "name": "Agent Product",
  "profileId": "domainforge-fabric",
  "repository": {
    "provider": "gitlab",
    "gitUrl": "https://gitlab.example.com/group/agent-prod.git",
    "username": "evopilot",
    "token": "<gitlab-token>",
    "defaultBranch": "main"
  }
}
```

响应中的关键字段：

```json
{
  "data": {
    "id": "agent-prod",
    "validation": {
      "status": "VERIFIED",
      "message": "GitLab 项目验证通过",
      "fileCount": 42
    },
    "repository": {
      "provider": "gitlab",
      "gitUrl": "https://gitlab.example.com/group/agent-prod.git",
      "credentialsConfigured": true
    }
  }
}
```

## 部署连接器

```http
GET /api/v1/connectors/deploy
POST /api/v1/connectors/deploy
```

部署连接器用于执行 source closure 的 `deploy` gate。当前内置 `http-webhook` 和 `ecs-docker-compose` 类型：EvoPilot 会向连接器 URL 发送结构化部署请求，或在配置的 ECS 工作目录中执行受限 Docker Compose 发布。连接器返回或生成 `deploymentId`、`deploymentUrl`、`healthUrl`、`readyUrl` 或 `statusUrl` 后，EvoPilot 将部署证据写回 `LoopRun.sourceClosure.gateEvidence.deploy`，再继续执行 health/ready 探测。读取接口会隐藏 `token`，只返回是否已配置。

请求示例：

```json
{
  "id": "prod-webhook",
  "name": "Production Deploy Webhook",
  "url": "https://deploy.example.com/evopilot",
  "tokenRef": "DEPLOY_WEBHOOK_TOKEN",
  "timeoutSeconds": 60,
  "healthPath": "/health",
  "readyPath": "/ready"
}
```

## 创建演进运行

```http
POST /api/v1/runs
```

生产客户端应包含 `X-Idempotency-Key`。

请求示例：

```json
{
  "projectId": "domainforge-fabric",
  "now": "2026-06-02T00:00:00.000Z",
  "events": [
    {
      "id": "e1",
      "type": "performance.latency",
      "source": "agent",
      "timestamp": "2026-06-02T00:00:00.000Z",
      "severity": "HIGH",
      "message": "p95 延迟升高"
    }
  ],
  "files": [
    "src/runtime-performance.ts",
    "test/runtime-performance.test.ts"
  ]
}
```

响应包含：

- 证据包。
- 演进机会。
- 优先级评分。
- 影响面映射。
- 演进计划。
- 评审记录。
- 交付计划。

## 进化证据接入

所有证据接入接口都要求 `operator` 或更高角色。不同接入方式最终都会转换为 `RuntimeEvidenceEvent`，并创建一次演进运行。

### 通用事件接入

```http
POST /api/v1/evidence/events
```

用于轻量 SDK、业务系统或自定义探针直接上报 Agent 运行证据。

请求示例：

```json
{
  "projectId": "domainforge-fabric",
  "events": [
    {
      "type": "agent.step",
      "message": "链路调用超过目标",
      "traceId": "trace-001",
      "attributes": {
        "durationMs": 3500
      }
    }
  ]
}
```

### OpenTelemetry Trace 接入

```http
POST /api/v1/evidence/otlp/v1/traces?projectId=domainforge-fabric
```

接收 OTLP JSON Trace。EvoPilot 会把 span 的耗时、traceId、service.name 和 GenAI 属性转换为进化证据。

### OpenTelemetry Log 接入

```http
POST /api/v1/evidence/otlp/v1/logs?projectId=domainforge-fabric
```

接收 OTLP JSON Log。错误日志会转换为高严重级别证据。

### SkyWalking 接入

```http
POST /api/v1/evidence/skywalking
```

接收 SkyWalking 链路或查询结果转换后的 JSON。EvoPilot 不替代 SkyWalking，只把 APM 信号转换为进化证据。

### 评测结果接入

```http
POST /api/v1/evidence/evaluations
```

用于外部评测系统、语义回归测试或 CI 回归套件上报评测结果。

### 用户反馈接入

```http
POST /api/v1/evidence/feedback
```

用于上报用户差评、投诉、满意度和人工标注，并与 traceId/sessionId 关联。

## 评审决策

```http
POST /api/v1/reviews/{reviewId}/decision
```

可接受的动作：

- `accept`
- `reject`
- `request-changes`
- `observe-only`

## 执行交付

```http
POST /api/v1/deliveries/{deliveryId}/execute
```

当项目策略要求用户确认且评审尚未确认时，交付会被阻断。

默认生产路径是项目 DevOps。项目配置了 `devops.provider=github-actions` 或 `gitlab-ci` 后，请求体可以不传 `executor`，EvoPilot 会在代码升级成功后触发对应平台并生成统一 `pipelineRun`。

GitHub Actions 请求示例：

```json
{
  "parameters": {
    "VERSION": "1.0.0"
  }
}
```

GitLab CI 请求示例：

```json
{
  "executor": "gitlab-ci",
  "parameters": {
    "VERSION": "1.0.0",
    "TARGET_ENV": "production"
  }
}
```

本地兼容执行请求示例：

```json
{
  "version": "1.0.0",
  "ciStatus": "PASSED"
}
```

GitHub Actions 和 GitLab CI 路径都会返回 `202` 和统一的 `pipelineRun`。EvoPilot 会刷新平台状态、stage/job/check evidence、日志摘要和原始链接；当流水线进入终态后，EvoPilot 生成发布报告、学习记录和审计记录。

## 流水线

```http
GET /api/v1/pipelines
GET /api/v1/pipelines/{pipelineRunId}
GET /api/v1/pipelines/{pipelineRunId}/logs
GET /api/v1/pipelines/{pipelineRunId}/artifacts
```

返回 EvoPilot 汇总后的流水线视图。GitHub Actions 会映射 workflow run 和 check runs；GitLab CI 会映射 pipeline 和 jobs。深度排障仍应跳转对应平台原始页面。

## GA Release 目标与发布判定

```http
GET /api/v1/release/targets
GET /api/v1/release/targets/{targetId}
POST /api/v1/release/targets
GET /api/v1/release/decisions
GET /api/v1/release/decisions?current=true
GET /api/v1/release/decisions?targetId=saas-ga
GET /api/v1/release/decisions?targetId=<targetId>&projectId=<projectId>
POST /api/v1/release/evidence
```

EvoPilot 自身定义“什么才算 GA Release”。外部 AI、通用 sub agent、CI/CD 编排器或人工执行验证时，都应先读取发布目标，再按目标执行场景验证 loop，最后生成 release evidence 和 release decision。

SaaS 多租户版本的正式发布状态以 `targetId=saas-ga` 为当前口径。`GET /api/v1/release/decisions?current=true` 只返回当前正式发布判定；历史 `ga` 判定仍保留为审计记录，但不会替代 SaaS 多租户版本的当前发布结论。`GET /api/v1/summary` 同时返回 `currentReleaseDecision` 和 `currentReleaseTargetId`，Dashboard 应优先使用这两个字段。

项目级发布治理使用标准等级模板和项目专属 target。`GET /api/v1/release/targets` 默认返回 `experimental`、`alpha`、`beta`、`rc`、`ga` 五个内置模板。管理员可以复制模板并提交 `scope: "project"`、`projectId`、`templateId` 创建某个 GitHub 项目的专属 target；随后 `POST /api/v1/release/evidence` 传入同一个 `projectId` 和 `releaseTargetId`，EvoPilot 只统计该项目的 pipeline、code upgrade、source release run、风险和场景证据。若 project-scoped target 绑定了 `projectId`，但 evidence 使用其他项目，服务端会返回 `RELEASE_TARGET_PROJECT_MISMATCH`。

项目级 target 示例：

```json
{
  "id": "github-owner-repo-beta",
  "name": "github-owner-repo Beta",
  "scope": "project",
  "projectId": "github-owner-repo",
  "templateId": "beta",
  "minConnectedProjects": 1,
  "minSuccessfulCodeUpgrades": 1,
  "minSuccessfulPipelines": 1,
  "requiredScenarioIds": ["beta-core-flow", "ci-cd-pass", "manual-approval"],
  "requireNoHighOpenRisks": true
}
```

项目级 evidence 示例：

```json
{
  "id": "github-owner-repo-beta-evidence",
  "projectId": "github-owner-repo",
  "releaseTargetId": "github-owner-repo-beta",
  "candidate": "github-owner-repo-beta",
  "scenarioMatrix": [
    { "id": "beta-core-flow", "name": "Beta Core Flow", "status": "PASS", "evidence": ["source-to-beta loop passed"], "required": true }
  ]
}
```

查询项目判定：

```http
GET /api/v1/release/decisions?targetId=github-owner-repo-beta&projectId=github-owner-repo
```

默认内置等级模板：

| 等级 | targetId | 用途 |
|---|---|---|
| Experimental | `experimental` | 早期实验，验证项目接入和最小证据链。 |
| Alpha | `alpha` | 内部试用，要求 smoke、基础运行证据和人工确认。 |
| Beta | `beta` | 有限用户试用，要求核心场景、CI/CD、代码升级和无高危开放风险。 |
| Release Candidate | `rc` | 候选发布，要求源码闭环、部署健康、回滚或修复证据。 |
| GA Release | `ga` | 正式稳定发布，要求完整 Source-to-GA 证据、稳定性和主流 Loop Harness 对齐。 |

默认内置 `ga` 目标：

| 目标项 | 默认门槛 |
|---|---:|
| 最少接入项目数 | 5 |
| 有负载成功持续验证时长 | 5400 秒 |
| 有负载 soak 运行增量 | 5 |
| 有负载 soak 代码升级增量 | 5 |
| 有负载 soak CI/CD 增量 | 5 |
| 成功证据运行数 | 5 |
| 评测集数量 | 10 |
| 机会点数量 | 5 |
| 成功进化批次数 | 5 |
| 成功代码升级数 | 5 |
| 成功 CI/CD 数 | 5 |
| 主流 Loop Harness 对齐证据 | 必须提供 |

默认 `ga` 必跑场景：

- `normal-evolution-loop`
- `ci-cd-failure-recovery`
- `llm-failure-containment`
- `scm-failure-containment`
- `cost-slo-governance`
- `manual-approval`
- `multi-project-isolation`
- `restart-recovery`
- `rollback`
- `data-governance`
- `mainstream-loop-harness-alignment`

`mainstream-loop-harness-alignment` 用于把 GA stable 的外部基线产品化：release evidence 必须说明 EvoPilot 与 GitHub 主流 Agent/Loop Harness 项目的关键能力对齐，包括 durable execution、checkpoint/persistence、human-in-loop、sandbox、multi-executor coordination、streaming trace、guardrails 和 source-to-production closure。没有这项场景证据时，release decision 会生成独立的 `mainstream-loop-harness-alignment` criterion，并返回 `NO-GO`。

对于 `saas-ga` 这类独立 SaaS 发布目标，不属于该目标 `requiredScenarioIds` 的历史 `ga` 场景会在 evidence matrix 中保留为审计行，并标记为 `NOT-APPLICABLE`、`required=false`；它们不再造成当前 SaaS 发布门禁 `NO-GO`。

`POST /api/v1/release/evidence` 默认使用 `releaseTargetId: "ga"`，返回的证据包会包含：

```json
{
  "releaseTargetId": "ga",
  "releaseDecisionId": "decision-rc-1",
  "status": "NO-GO"
}
```

对应判定可从 `GET /api/v1/release/decisions` 查询。每条判定包含 `criteria`，逐项说明实际值、目标值、PASS/FAIL 和证据。若未达到 GA，例如只接入 1 个项目，`min-connected-projects` 会失败，最终为 `NO-GO`。

默认 `ga` 目标要求 `requireActiveSoak=true`。仅健康检查持续存活不计入 GA 稳定性证明；soak 报告必须证明 `runCount`、`codeUpgradeCount` 和 `pipelineCount` 相比基线产生真实活动增量。

## GlobalGoal

```http
GET /api/v1/goals
POST /api/v1/goals
GET /api/v1/goals/{goalId}
POST /api/v1/goals/{goalId}/plan
POST /api/v1/goals/{goalId}/approve-plan
GET /api/v1/goals/{goalId}/targets
POST /api/v1/goals/{goalId}/advance
GET /api/v1/goals/{goalId}/snapshot
GET /api/v1/goals/{goalId}/run-status
GET /api/v1/goals/{goalId}/graph
GET /api/v1/goals/{goalId}/timeline
GET /api/v1/goals/{goalId}/evidence-matrix
GET /api/v1/goals/{goalId}/final-report
```

GlobalGoal 是 release target 和 LoopRun 之间的目标规划层。它适合表达“让某个项目达到 RC/GA”这类全局目标：服务端根据项目级 release target 生成多个有依赖关系的 GoalTarget，再把每个 GoalTarget 绑定到受控 LoopRun 推进。GlobalGoal 不替代 `GET /api/v1/release/decisions` 的最终发布判定，也不绕过 Loop Runtime 的 sandbox、approval、source closure、worker 和 audit 边界。

创建目标示例：

```json
{
  "id": "my-agent-rc-global-goal",
  "projectId": "my-agent",
  "releaseTargetId": "my-agent-rc",
  "objective": "Move my-agent to RC with source closure, deployment evidence, release decision, and blocker review."
}
```

典型推进顺序：

1. `POST /api/v1/goals` 创建目标，初始状态为 `DRAFT`。
2. `POST /api/v1/goals/{goalId}/plan` 生成 GoalTargets，状态进入 `PLANNED / PENDING_APPROVAL`。
3. `POST /api/v1/goals/{goalId}/approve-plan` 批准计划。
4. `GET /api/v1/goals/{goalId}/snapshot`、`graph`、`timeline`、`evidence-matrix` 读取白盒状态。
5. `POST /api/v1/goals/{goalId}/advance` 推进一个服务端治理步骤。
6. 目标终态后读取 `GET /api/v1/goals/{goalId}/final-report`。

`advance` 返回 schema `evopilot-goal-advance/v1`，其中 `nextAction` 是自动化和 Dashboard 的主要路由字段。常见值包括 `plan-goal`、`approve-plan`、`start-target`、`resume-loop`、`human-approval`、`configure-source-credentials`、`repair-project`、`repair-deploy-target`、`policy-review`、`release-decision`、`view-final-report`、`done` 和 `repair`。调用方遇到人工、凭据、部署、策略或 repair 类型动作时应停止自动推进并展示阻塞原因。

`run-status` 返回 schema `evopilot-goal-run-status/v1`，是 CLI wrapper commands 和 Dashboard 白盒视图共享的聚合投影。它包含 `scope`、`goal`、`snapshot`、`graph`、`timeline`、`evidenceMatrix`、`activeTarget`、`latestLoop`、`releaseDecision`、`finalReport`、`chain`、`blockers` 和 `nextAction`。CLI 的 `target run` / `goal run` 会用这个接口打印终端版 workflow 链路，而不是在客户端猜测状态。

Dashboard 的 GlobalGoal Cockpit 直接消费这些投影接口，而不是从多个 LoopRun 拼接状态：

| 接口 | Dashboard 用途 |
|---|---|
| `snapshot` | 状态、进度、active GoalTarget、下一步动作、blockers 和 release decision 摘要。 |
| `run-status` | CLI / Dashboard 共用的聚合运行视图，包含链路、最新 Loop、阻塞项和 release decision。 |
| `graph` | GoalTarget 依赖图和绑定的 LoopRun。 |
| `timeline` | 目标创建、计划、批准、绑定、推进和完成事件。 |
| `evidence-matrix` | 每个 GoalTarget 的 acceptance criteria、evidence、blocker 和 loopId。 |
| `final-report` | 终态目标报告和 release decision 引用。 |

## Loop Runtime

```http
GET /api/v1/executor-graphs
POST /api/v1/executor-graphs
GET /api/v1/executor-graphs/{graphId}
GET /api/v1/loops
POST /api/v1/loops
GET /api/v1/loops/{loopId}
POST /api/v1/loops/{loopId}/start
POST /api/v1/loops/{loopId}/resume
POST /api/v1/loops/{loopId}/replay
POST /api/v1/loops/{loopId}/approve
POST /api/v1/loops/{loopId}/cancel
GET /api/v1/loops/{loopId}/timeline
GET /api/v1/loops/{loopId}/evidence
GET /api/v1/loops/{loopId}/artifacts
GET /api/v1/loops/{loopId}/trace
GET /api/v1/loops/{loopId}/trace-tree
GET /api/v1/loops/{loopId}/events
GET /api/v1/loops/{loopId}/executor-graph
GET /api/v1/loops/{loopId}/sandbox-proof
POST /api/v1/loops/{loopId}/sandbox-proof/verify
GET /api/v1/loop-store
GET /api/v1/loop-store/readiness
GET /api/v1/loop-observability
GET /api/v1/saas/observability
GET /api/v1/loop-orchestration/presets
GET /api/v1/loop-orchestration/targets
POST /api/v1/loop-orchestration/advance
POST /api/v1/loop-orchestration/autopilot
POST /api/v1/loop-orchestration/instantiate
POST /api/v1/loop-workers/heartbeat
GET /api/v1/loop-workers/leases
GET /api/v1/loop-workers/queue
POST /api/v1/loop-workers/claim
GET /api/v1/loops/{loopId}/checkpoints
POST /api/v1/loops/{loopId}/time-travel/replay
POST /api/v1/loops/watchdog
POST /api/v1/im/feishu/webhook
POST /api/v1/im/wecom/webhook
```

Loop Runtime 是 EvoPilot 的 Loop Engineering 内核。它把 API、Codex、IM、定时任务、运行时信号、release target 和 evolution batch 统一成 `LoopRun`，并通过 `ExecutorGraph` 编排 LLM、code-upgrader、CI、validator、approval 和 release-action 等 executor。

`ExecutorGraph` 节点通过 `ExecutorAdapter` 执行。节点可以在 `config.adapterId` 中固定 adapter；未指定时，EvoPilot 按节点类型解析默认 adapter。adapter 必须返回结构化 `status`、`output`、`evidence` 和可选 `failureSignature`，因此后续 target loop 可以复用同一执行边界，而不是把执行结果写成不可审计的状态文本。

`GET /api/v1/loops/{loopId}/executor-graph` 返回当前 Loop 绑定的 graph contract、coordination plan、validation result、capabilities 和 evidence。Dashboard Loop 执行页的 Source-to-GA 动态本体链路图会把该接口与 project、target runtime、loop、worker queue、trace tree、events、sandbox proof、source-closure plan、source release run、deploy finalizer 和 release decision 数据合并，形成 `SCM/Git Project -> Discovery Candidate -> Target Backlog -> Executor Graph -> Worker + Sandbox -> Human Gate -> Source Closure -> CI/CD + Deploy -> Release Decision -> GA Release` 的运行视图。该视图只解释当前运行边界，不替代 `GET /api/v1/release/decisions` 的 GA verdict。

Dashboard 编排入口通过 `GET /api/v1/loop-orchestration/presets` 返回可用闭环预设，通过 `POST /api/v1/loop-orchestration/instantiate` 创建标准 source-to-production target loop。预设会自动绑定 typed executor graph、`sourceClosure`、Docker sandbox enforcement、worker/watchdog 语义、deploy connector 和 health-ready rollback。

`GET /api/v1/loop-orchestration/targets` 返回按 Sandbox、Context、Harness、Loop 四层组织的 target backlog。每个 target 包含 `status`、`nextAction`、`acceptanceCriteria`、`loopId` 和证据摘要。`POST /api/v1/loop-orchestration/advance` 会选择指定 target 或下一个待推进 target，若没有对应 LoopRun 则创建 Codex-backed target loop；若已有 LoopRun 则根据状态执行 start/resume，遇到 `WAITING_APPROVAL` 时返回 human stop condition，遇到成功但未发布时返回 source-closure next action。

当前 backlog 还包含下一轮 GA 对齐 target loop：`discovery-skill-runtime`、`per-finding-worktree-handoff`、`adversarial-evaluator-agent`、`recurring-loop-scheduler`、`loop-memory-inbox` 和 `budget-and-judgment-guardrails`。这些目标分别覆盖发现技能运行时、单 finding 隔离 worktree handoff、独立对抗评估、周期性 loop 调度、产品记忆 inbox，以及成本/判断护栏。它们复用 `codex-target-loop` preset，因此 Dashboard 的 Target Loop Backlog 可以直接推进或自动驾驶，而不需要用户重新手工复制目标描述。

Target backlog 也承载 EvoPilot 云服务化自进化路径。当前 SaaS ladder 包含 `tenant-workspace-model`、`workspace-rbac-and-invitation`、`github-app-onboarding`、`secret-vault-and-credential-boundary`、`project-workspace-ownership`、`quota-rate-limit-billing-foundation`、`worker-queue-and-postgres-store`、`tenant-aware-release-evidence`、`multi-tenant-security-regression-suite`、`saas-production-observability`、`saas-onboarding-dashboard`、`saas-field-e2e-source-to-ga`、`saas-release-matrix`、`saas-ga-soak-active`、`saas-ga-release-decision` 和 `announce-saas-multi-tenant-ga-stable`。当生产环境已经注册 EvoPilot GitHub 仓库为 `evopilot-github` 时，可通过 `POST /api/v1/loop-orchestration/advance` 指定任一 SaaS `targetId`、`projectId=evopilot-github` 创建或推进对应自进化 loop。

已落地的 SaaS 控制面能力包括 tenant/workspace 默认模型、workspace RBAC/invitation、项目 ownership scope、workspace quota、AES-256-GCM 本地 secret vault、GitHub App installation readiness、tenant-aware release evidence、跨租户功能回归测试和 `/api/v1/saas/observability`。`worker-queue-and-postgres-store` 仍以 `/api/v1/loop-store/readiness` 为准；在 Postgres store 未配置前，该 target 和最终 SaaS GA decision 必须保持阻断。

这些 target 同时暴露为通用产品运行时 API：

```http
GET /api/v1/loop-target-runtime/summary
POST /api/v1/loop-target-runtime/discovery/run
GET /api/v1/loop-target-runtime/discovery/candidates
POST /api/v1/loop-target-runtime/handoffs
GET /api/v1/loop-target-runtime/handoffs
POST /api/v1/loop-target-runtime/adversarial-evaluations
GET /api/v1/loop-target-runtime/adversarial-evaluations
POST /api/v1/loop-target-runtime/schedules
GET /api/v1/loop-target-runtime/schedules
GET /api/v1/loop-target-runtime/memory-inbox
POST /api/v1/loop-target-runtime/memory-inbox/{itemId}/triage
POST /api/v1/loop-target-runtime/guardrails/{loopId}/evaluate
GET /api/v1/loop-target-runtime/guardrails
```

Discovery runtime 会把仓库、trace、evaluation、production 和 manual signals 归一成 `evopilot-discovery-skill-candidate/v1`，并把 provenance 写入 `evopilot-loop-memory-inbox-item/v1`。Handoff API 为单个 finding 分配 workspace、target branch、allowed paths、validation commands 和 rollback ref。Adversarial evaluation 返回 `PASS`、`WARN` 或 `BLOCK`，其中 `BLOCK` 会使用 HTTP 409，表示缺少 source closure、release decision 或其他独立证据。Recurring schedule 记录 cadence、trigger rules、budget、next-run time 和 idempotency key。Guardrail evaluation 对 cost、tokens、duration、changed files、confidence 和 release judgment 给出 `ALLOW`、`HUMAN_REVIEW` 或 `BLOCK`。

`POST /api/v1/loop-orchestration/autopilot` 是管理员级生产自动驾驶入口。请求体可包含 `targetId`、`projectId`、`targetVersion`、`deployConnectorId`、`controlPlaneUrl`、`files`、`maxSteps`、`approveHumanGate`、`autoMerge` 和 `postMergeDeploy`。返回 schema 为 `evopilot-loop-orchestration-autopilot/v1`，包含 `status`、`target`、`loop`、`releaseRun`、`stages`、`nextAction`、可选 `externalBlocker` 和 `evidence`。它会先调用 target advance，在有界步数内 start/resume loop；如果遇到 human gate 且未显式传入 `approveHumanGate=true`，会以 `BLOCKED / nextAction=human-approval` 停止。授权通过后，它会先运行 source closure preflight，再执行 source closure，默认生成 `docs/evopilot-source-closures/{loopId}.md` 作为可审计变更；随后执行 safe auto-merge 和 post-merge deploy。策略不通过时不会强行合并，而是返回 `BLOCKED / nextAction=policy-review` 并把 blocker 写回 release run。

当 preflight 发现 GitHub/GitLab 写回 token 缺失或 `tokenRef` 未解析时，autopilot 不再把它归类为普通执行失败，而是返回 `BLOCKED / nextAction=configure-source-credentials`，并附带 `evopilot-external-blocker/v1`。该 blocker 包含 `type=source-credential`、`projectId`、`provider`、`blockers`、`recovery.route=project-source-credentials` 和 Dashboard 恢复动作；`GET /api/v1/loop-orchestration/targets` 会从持久化 preflight evidence 中恢复同一个 blocker。用户在 Dashboard “接入项目 -> 配置凭据”保存 `tokenRef` 或 inline token 并达到 `READY` 后，可重新点击 target autopilot 继续 source closure、PR/MR、merge 和部署闭环。

Dashboard 的 Context Time Travel Workbench 使用 `GET /api/v1/loops/{loopId}/checkpoints` 读取每轮 checkpoint。checkpoint 包含 iteration、decision、context snapshot、context patch、executor outputs 和 replayable 标记。`POST /api/v1/loops/{loopId}/time-travel/replay` 接收 `fromIteration`、`contextPatch`、`evidence`、`artifacts` 和可选 `forceDecision`，执行 replay 后返回 `{ loop, checkpoint, replayDiff }`；`replayDiff` 会列出 context changed keys、原 iteration 与 replay iteration 的 executor output 差异和证据摘要。

Dashboard 的 Worker Queue Workbench 使用 `GET /api/v1/loop-workers/queue` 显示可 claim loop、worker lease、过期 lease、下一步动作和 duplicate source-closure side-effect guard。`POST /api/v1/loop-workers/claim` 接收 `workerId`、可选 `loopId` 和 `leaseSeconds`；指定 `loopId` 时优先 claim 该 loop，未指定时 claim 下一条可执行 loop，并返回 `evopilot-loop-worker-claim/v1`、刷新后的 queue 和 claim 证据。

Dashboard 的 Sandbox Boundary Workbench 使用 `GET /api/v1/loops/{loopId}/sandbox-proof` 读取 `evopilot-loop-sandbox-boundary-proof/v1`。Docker loop 会返回可执行 `docker run` 参数，包括 `--read-only`、`--network none|bridge`、CPU/内存/pids 限制、workspace mount、凭据作用域和 probe 脚本；K8s loop 会返回 Job manifest、readonly filesystem、resources 和 namespace。`POST /api/v1/loops/{loopId}/sandbox-proof/verify` 会把 runtime、network、credential、path、resource 五类检查写回 loop context、timeline 和 audit。

Dashboard 的 Streaming Trace Workbench 使用 `GET /api/v1/loops/{loopId}/trace-tree` 读取 trace tree，节点包含 loop、iteration、executor-step、checkpoint、worker-lease、failure-group、replay-diff 和 sandbox-proof。`GET /api/v1/loops/{loopId}/events` 默认返回 JSON event list；请求头包含 `Accept: text/event-stream` 时返回 SSE，每条事件包含 `timeline`、`executor-step`、`checkpoint`、`worker-lease`、`cost`、`failure-group`、`replay-diff` 或 `sandbox-proof` 类型。

`ExecutorGraph.edges` 支持 typed edge：`type=sequence|conditional|fan-out|fan-in`、`condition`、`inputSchemaRef` 和 `outputSchemaRef`。EvoPilot 会在 graph 中写入 `validation.status`、`validation.evidence` 和 `capabilities`，用于判断是否具备 typed edge、条件路由、fan-out/fan-in、nested subgraph 和 schema validation 能力。

每个 target loop 都必须显式形成源码到生产的闭环契约。`POST /api/v1/loops` 支持 `sourceClosure`，未提供时会根据已注册项目仓库自动补齐：

```json
{
  "sourceClosure": {
    "sourceProjectId": "evopilot-github",
    "repositoryProvider": "github",
    "sourceUrl": "https://github.com/yeliang-wang/EvoPilot.git",
    "sourceBranch": "main",
    "targetVersion": "2.0.0",
    "releaseStrategy": "github-push",
    "requiredGates": ["code-change", "push", "tag", "deploy", "health-ready"],
    "deploymentEnvironment": "production"
  }
}
```

该契约会进入 `LoopRun.sourceClosure`、每个 executor step 的 `input/output.sourceClosure`、独立 `LoopEvidenceSet.evidence` 和 Dashboard Loop 表格。这样任何项目的 target loop 都能追溯“控制面在哪里执行、源码在哪里、目标版本是什么、是否需要 push/tag/deploy/health-ready”，避免只把 loop 状态推进为成功却没有代码回写和生产部署闭环。

GitHub、GitLab 与本地目录项目还支持执行源码闭环：

```http
POST /api/v1/loops/{loopId}/source-closure/execute
```

该接口需要 `admin` 权限。请求体可传入：

```json
{
  "branchName": "evopilot/workbuddy-2.0.0",
  "files": [
    {
      "path": "docs/evopilot-source-closures/workbuddy.md",
      "content": "release evidence"
    }
  ],
  "commitMessage": "EvoPilot source closure for workbuddy",
  "tagName": "v2.0.0",
  "createReviewRequest": true,
  "deployConnectorId": "prod-webhook",
  "deployParameters": {
    "strategy": "rolling"
  },
  "deploymentUrl": "http://8.153.72.80",
  "healthUrl": "http://8.153.72.80/health",
  "readyUrl": "http://8.153.72.80/ready"
}
```

GitHub 路径会读取 base ref、创建 release branch、通过 Contents API 写入文件、创建 PR，并在需要 `tag` gate 时创建 tag。GitLab 路径会创建 branch、提交 commit actions、创建 MR，并在需要 `tag` gate 时创建 tag。本地目录路径会在注册的 `repository.root` 内创建或切换 release branch、写入文件、提交并在需要时打 tag；默认要求干净工作树，除非请求显式传入 `allowDirtyWorktree=true`。如果传入 `deployConnectorId`，EvoPilot 会调用部署连接器并把连接器返回的部署结果写入 deploy gate。执行后 `LoopRun.sourceClosure` 会包含：

预检接口不会创建分支或写文件，只验证项目绑定、provider、凭据解析、source branch 可读、deploy target 和 health-ready 条件。`POST` 会把预检结果写入 loop evidence 和 timeline：

```http
GET /api/v1/loops/{loopId}/source-closure/preflight
POST /api/v1/loops/{loopId}/source-closure/preflight
```

失败响应为 `409`，响应体 schema 为 `evopilot-source-closure-preflight/v1`，包含 `status`、`blockers`、`checks`、`nextAction` 和 `capabilities`。例如缺少 GitHub/GitLab 写回 token 时，blocker 为 `credentials:SOURCE_CLOSURE_TOKEN_REQUIRED`。

- `closureState`: `PLANNED`、`CODE_CHANGED`、`PUSHED`、`TAGGED`、`DEPLOYED`、`HEALTH_READY`、`HEALTH_FAILED`、`ROLLED_BACK`、`PROMOTED` 或 `FAILED`。
- `gateEvidence`: 每个 required gate 的 `PENDING`、`PASSED`、`FAILED` 或 `SKIPPED` 状态和证据。
- `artifacts`: branch、commitSha、pullRequestUrl、mergeRequestUrl、tag、deploymentConnectorId、deploymentId、deploymentUrl、deployStatusUrl、healthUrl、readyUrl、executedAt、executedBy。

响应体还会附带 `sourceReleaseRun`，schema 为 `evopilot-source-release-closure-run/v1`。该运行记录把源码发布闭环提升为可查询的产品资源，包含 provider、releaseStrategy、sourceRef、targetVersion、stages、review、policy、postMergeDeployment、artifacts、capabilities、nextAction 和 status。查询接口：

```http
GET /api/v1/source-release-runs
GET /api/v1/loops/{loopId}/source-release-runs
GET /api/v1/loops/{loopId}/source-closure/plan
GET /api/v1/source-release-runs/repair-candidates
POST /api/v1/source-release-runs/repair-candidates/repair
```

`source-closure/plan` 会返回该 loop 最新的 release run；如果还没有执行过，则根据当前 `sourceClosure` 生成计划视图。Dashboard 的 Release Closure Runtime 工作台使用这些接口展示阶段、next action、capabilities、source ref 和 artifacts。

`repair-candidates` 会返回需要人工或自动修复的 release run，默认包含 `FAILED`、`HEALTH_FAILED`、`ROLLED_BACK` 等失败或陈旧状态，并排除已经被后续成功运行修复的候选。返回项包含 run、loop、project、provider、source ref、target version、失败 stage、failure signature、next action、capabilities 和推荐 repair request。Dashboard 的 Release Run Auto Repair Workbench 使用该接口展示队列。

修复接口支持单条或批量修复：

```json
{
  "runIds": ["loop-a-source-release-1782645327477"],
  "execute": true,
  "repairRequest": {
    "allowDirtyWorktree": true,
    "files": [
      {
        "path": "docs/release-evidence.md",
        "content": "release evidence"
      }
    ],
    "commitMessage": "Repair source release closure"
  }
}
```

当 `execute=true` 时，EvoPilot 复用同一条 source-closure 执行路径，而不是直接改写状态：重新运行 SCM 写回、deploy connector、health/ready、release policy 和 evidence 写入。成功后会创建新的 `evopilot-source-release-closure-run/v1`，原失败候选不再出现在 repair queue；失败时保留 blocker、stage evidence 和 next action。生产 ECS 演练已验证：一个本地 Git 项目先因 dirty worktree 产生 `FAILED` release run，随后在 Dashboard 点击单行“修复”后生成 `PROMOTED` release run，并从 repair candidates 队列移除。

Release review 决策接口：

```http
POST /api/v1/loops/{loopId}/source-closure/review-decision
```

请求体：

```json
{
  "action": "auto-merge",
  "commitMessage": "Merge EvoPilot release branch",
  "postMergeDeploy": true
}
```

`action` 支持 `approve`、`reject`、`merge` 和 `auto-merge`。`approve` 会把 release run 的 review stage 标记为 `APPROVED`；`reject` 会标记为 `REJECTED` 并停止 merge next action；`merge` 会要求 release 已批准，除非传入 `force=true`。`merge` 和 `auto-merge` 都会先执行 release policy gate，默认要求 required gates 全部通过、没有失败 gate、closure 已 `PROMOTED`、review 已批准、有 source commit，并且 GitHub/GitLab 路径存在 PR/MR artifact；不通过时返回 `409 SOURCE_CLOSURE_RELEASE_POLICY_BLOCKED`，同时把 `policy.status=BLOCKED`、`policy.blockers` 和 evidence 写回同一条 release run。`forcePolicy=true` 只用于管理员显式旁路策略，但仍会记录为非必需 policy check。

GitHub 路径调用 PR merge API，GitLab 路径调用 MR merge API，本地目录路径会在 `repository.root` 中切回 `sourceBranch` 并执行 `git merge --no-ff <releaseBranch>`。合并后会写回 `review.status=MERGED`、`artifacts.mergeCommitSha`、`mergedAt`、`mergedBy` 和独立 evidence set。默认 `postMergeDeploy=true`，当 loop 要求 `deploy` 且存在 deploy connector 时，EvoPilot 会在 merge commit 上再次调用 deploy connector 并探测 health/ready，把 `postMergeDeployment.status`、deploymentId、deploymentUrl、healthUrl、readyUrl 和 rollback evidence 写回 release run；可传入 `postMergeDeploy=false` 跳过该阶段。

没有配置 `deployConnectorId` 时，部署 gate 仍兼容旧行为：只记录 `deploymentUrl` 并探测 health/ready URL。配置部署连接器后，deploy gate 必须由连接器真实返回成功才会 `PASSED`。内置连接器类型包括：

- `http-webhook`：调用外部部署系统，由外部系统返回 deployment/probe URL。
- `ecs-docker-compose`：在生产服务器的受限 `workingDir` 中执行 `git rev-parse`、可选 `git pull --ff-only` 和 `docker compose up -d --build`，把部署 commit 和命令输出写入 gate evidence。默认开启部署锁、幂等 stamp 和 compose 失败回滚。若生产机必须保留本地补丁文件，可配置 `preserveLocalPaths`，连接器会在 pull 前 stash 这些路径并在 pull 后恢复。

注册 ECS Docker Compose 连接器示例：

```http
POST /api/v1/connectors/deploy
```

```json
{
  "id": "ecs-prod-compose",
  "name": "ECS production Docker Compose",
  "type": "ecs-docker-compose",
  "workingDir": "/opt/evopilot",
  "composeFile": "docker-compose.prod.yml",
  "serviceName": "evopilot-server",
  "gitRemote": "origin",
  "gitBranch": "main",
  "gitPull": true,
  "preserveLocalPaths": ["Dockerfile"],
  "build": true,
  "skipComposeWhenUnchanged": true,
  "deployLock": true,
  "idempotency": true,
  "rollbackOnFailure": true,
  "rollbackOnHealthFailure": true,
  "url": "http://8.153.72.80",
  "healthPath": "/health",
  "readyPath": "/ready",
  "timeoutSeconds": 120
}
```

执行时可在 `deployParameters.releaseKey` 指定幂等 key；未指定时 EvoPilot 会用 loop、源码 commit、tag 和 target version 生成默认 key。`deployLock=true` 时，同一个 connector 在同一 `workingDir` 中只允许一个部署执行。`skipComposeWhenUnchanged=true` 适用于 EvoPilot 自托管部署：如果 `git pull` 后 commit 没有变化，连接器会记录 `composeSkipped=unchanged` 并交给 health-ready gate 验证，避免控制面在自己的 API 请求中重启自己。`rollbackOnFailure=true` 时，`docker compose up` 失败会触发 `git reset --hard <beforeCommit>` 并重新运行 compose，deploy gate 证据会包含 `rollbackStatus`。`rollbackOnHealthFailure=true` 时，compose 发布成功但 health/ready 探测失败会基于 deploy stamp 回滚到发布前 commit，并把 `rollbackStatus`、`rollbackTargetCommit` 和回滚命令输出写入 `health-ready` gate 证据；此时 `closureState` 为 `ROLLED_BACK`，不会被提升为 `PROMOTED`。

K8s/云发布执行器应接入该 deploy connector contract，而不是在 source closure 里硬编码平台逻辑。

剩余 target loop 对应的能力也属于 Loop Runtime 通用模型：

- `persistent-loop-store`：`GET /api/v1/loop-store` 返回当前 store backend、lock provider 和 idempotent replay 恢复语义。默认是 `file`；生产可通过 `EVOPILOT_LOOP_STORE_BACKEND=sqlite|postgres` 和 `EVOPILOT_LOOP_STORE_DSN` 声明 SQLite/Postgres store contract，DSN 会脱敏返回。
- `postgres-business-store`：`scripts/postgres-business-store.mjs` 提供文件态业务数据到 Postgres 的 `migrate`、`backup`、`restore` 操作。Postgres 表 `evopilot_business_records` 使用 `collection + tenant_id + workspace_id + record_id` 作为幂等主键，并以 JSONB 保存 tenants、workspaces、projects、loops、release evidence、release decisions、source release runs、target loops、audit events 和 idempotency records。发布前先执行 `npm run store:postgres:migrate -- --data-root data/evopilot --dry-run` 核对迁移数量。
- `replay-and-human-edit`：`POST /api/v1/loops/{loopId}/replay` 支持 `fromIteration`、`contextPatch`、`evidence` 和 `artifacts`，会从指定 iteration 重新执行，并把人工编辑写入 loop context、timeline 和 iteration。Dashboard 原生 Context Time Travel Workbench 还通过 `GET /api/v1/loops/{loopId}/checkpoints` 和 `POST /api/v1/loops/{loopId}/time-travel/replay` 暴露 checkpoint inspection、context edit 和 replay diff。
- `durable-worker-queue`：`GET /api/v1/loop-workers/queue` 返回 claimable loops、lease 过期状态、next action 和 duplicate source-closure side-effect guard；`POST /api/v1/loop-workers/claim` 支持 worker claim/renew/failover 和 crash-resume。
- `sandbox-runtime`：创建 loop 时可传 `sandbox.runtime=host|docker|k8s`、`credentialScope`、`network`、`allowedPaths`、`deniedPaths` 和 `resourceLimits`。每个 loop 会返回 `sandboxEnforcement`；Docker/K8s 边界齐备时为 `ENFORCED`，host 为 `POLICY_ONLY`，缺少关键边界时为 `FAILED` 并阻断非审批节点。Sandbox Boundary Workbench 还会生成 Docker/K8s 可执行边界 proof，并把五类边界检查写回 LoopRun。
- `multi-executor-coordination`：`ExecutorGraph.mode=serial|parallel`，LoopRun 会返回 `coordination.nodes[]`，包含每个 executor 的依赖、输入 schema、输出 schema 和共享 context keys；依赖会带上 edge type 与条件路由信息。
- `loop-observability`：`GET /api/v1/loop-observability` 聚合 loop trace；`GET /api/v1/loops/{loopId}/trace` 返回单个 loop 的 executor step 数、worker lease、watchdog、成本和失败签名；`GET /api/v1/loops/{loopId}/trace-tree` 和 `GET /api/v1/loops/{loopId}/events` 支持 trace tree、streaming events、checkpoint/time-travel inspection、per-node cost/tokens、failure grouping 和 replay diff。

每轮 loop 都会生成：

- `LoopIteration`：本轮执行步骤、输入输出、失败签名和决策。
- `LoopEvidenceSet`：由 `evopilot-loop-runtime` 独立生成的证据集合，避免 executor 自证成功。
- `LoopTimelineEvent`：创建、启动、迭代、证据、决策、审批、heartbeat、watchdog 等事件。
- `LoopArtifact`：报告、diff、CI 日志、审批记录等产物索引。

`StopPolicy` 控制最大轮次、最大持续时间、发布审批要求和重复失败阻断；`RetryPolicy` 控制单节点重试、退避时间和 circuit breaker。`/api/v1/loop-workers/heartbeat` 写入 worker lease，`/api/v1/loops/watchdog` 会释放过期 lease 或按 stop policy 阻断超时 loop。

`npm run loop-worker` 启动独立 worker 进程，持续拉取 `PENDING` / `RUNNING` loop、写入 heartbeat lease、推进 start/resume 并交给 watchdog 恢复过期任务。`npm run loop:soak` 默认按 24 小时持续验证 Loop Runtime，可通过 `EVOPILOT_LOOP_SOAK_SECONDS` 缩短本地验证时间。

飞书和企业微信 webhook adapter 使用 `/api/v1/im/feishu/webhook` 与 `/api/v1/im/wecom/webhook` 接收消息并创建 `LoopRun`。生产环境应在 API 网关或 adapter 层增加企业签名校验、消息去重和回调凭据保护。

## ProofOps Target Loop Mode

```http
GET /api/v1/target-loops
POST /api/v1/target-loops
GET /api/v1/target-loops/{loopId}
POST /api/v1/target-loops/{loopId}/approve-plan
POST /api/v1/target-loops/{loopId}/resume
GET /api/v1/target-loops/{loopId}/final-report
POST /api/v1/target-loops/{loopId}/route-remediation
POST /api/v1/target-loops/{loopId}/release-actions/{action}/approve
POST /api/v1/target-loops/{loopId}/release-actions/{action}/execute
POST /api/v1/conversations/commands
```

EvoPilot 内置 ProofOps Mode。ProofOps 不再作为独立 AMP 控制面运行，而是作为目标驱动 release/maturity loop 契约被 EvoPilot 消费。

一次 target loop 的基本流程：

1. 创建 target loop，生成 ProofOps-compatible target plan。
2. 用户或审批策略确认 target plan。
3. EvoPilot 执行或恢复 target loop，聚合 release evidence 并生成 decision chain。
4. 输出 `proofops-final-release-report/v1` 格式的 final report。
5. 若未达成目标，阻塞项可通过 `route-remediation` 路由给 EvoPilot 自演进、代码升级和 CI/CD 复验能力。
6. 若结果为 `GO`，发布、tag、deploy、rollback 等发布动作仍需管理员审批；审批后再执行并写入审计。

Codex、飞书、企业微信等入口应把用户对话转成 `POST /api/v1/conversations/commands`。该接口是统一的 conversation gateway 后端入口，当前支持通过自然语言命令创建 ProofOps target loop；具体 IM webhook 只负责鉴权、签名校验和消息转发。

## 审计

```http
GET /api/v1/audit
GET /api/v1/history
```

返回追加写入的审计记录，包括项目创建、运行创建、评审决策和交付执行。

`GET /api/v1/history` 是 Dashboard “审计/历史详情”的统一产品历史接口，会按当前登录用户的 tenant/workspace 权限聚合 completed run release、source release run、release decision、code upgrade run 和 audit 摘要。支持 `projectId`、`targetId` 和 `limit` 查询参数，用于发布后证据复盘。
