# EvoPilot API

## 健康检查

```http
GET /health
```

返回服务状态、当前项目画像、数据目录，以及 API 是否需要鉴权。

## 鉴权

配置 `EVOPILOT_API_TOKEN` 后，所有 `/api/v1/*` 请求都需要：

```text
Authorization: Bearer <token>
```

`/health` 和控制台静态文件保持公开，用于健康探测和本地查看。

可以通过 `EVOPILOT_TOKENS` 配置多角色 Token：

```text
admin:<token>:admin,operator:<token>:operator,viewer:<token>:viewer
```

角色能力：

- `viewer`：只读访问 API。
- `operator`：创建演进运行，提交评审决策。
- `admin`：注册项目，执行交付。

## 汇总

```http
GET /api/v1/summary
```

返回项目数、运行数、机会点数、评审数量、发布数量、发布健康度和近期运行记录。

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

读取项目列表时不会回显 `password` 或 `token`，只返回 `credentialsConfigured`。

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

## 外部 Jenkins CI/CD 连接器

```http
GET /api/v1/connectors/jenkins
POST /api/v1/connectors/jenkins
```

Jenkins 是 EvoPilot 的外部 CI/CD 连接器。该接口用于系统管理员配置系统默认 Jenkins，也可以供项目注册流程创建项目独立 Jenkins 连接器。读取接口会隐藏 `apiToken`，只返回是否已配置。

请求示例：

```json
{
  "id": "default",
  "name": "生产 Jenkins",
  "baseUrl": "https://jenkins.example.com/",
  "username": "evopilot",
  "apiToken": "<jenkins-api-token>",
  "jobTemplates": {
    "default": "agent-evolution-delivery",
    "domainforge-fabric": "domainforge-fabric-evolution"
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

本地兼容执行请求示例：

```json
{
  "version": "1.0.0",
  "ciStatus": "PASSED"
}
```

Jenkins 执行请求示例：

```json
{
  "executor": "jenkins",
  "connectorId": "default",
  "job": "domainforge-fabric-evolution",
  "parameters": {
    "VERSION": "0.2.0",
    "TARGET_ENV": "staging"
  }
}
```

Jenkins 路径会返回 `202` 和 `pipelineRun`。EvoPilot 会通过 Jenkins API 拉取 Queue、Build、Stage、Console Log 和 Artifact；当 Jenkins 完成后，EvoPilot 生成发布报告、学习记录和审计记录。

## 流水线

```http
GET /api/v1/pipelines
GET /api/v1/pipelines/{pipelineRunId}
GET /api/v1/pipelines/{pipelineRunId}/logs
GET /api/v1/pipelines/{pipelineRunId}/artifacts
```

返回 EvoPilot 汇总后的 Jenkins 流水线视图，包括 Job、Build Number、Stage、Artifact、日志摘要和 Jenkins 原始链接。深度排障仍应跳转 Jenkins 原始页面。

## GA Release 目标与发布判定

```http
GET /api/v1/release/targets
GET /api/v1/release/targets/{targetId}
POST /api/v1/release/targets
GET /api/v1/release/decisions
POST /api/v1/release/evidence
```

EvoPilot 自身定义“什么才算 GA Release”。外部 AI、通用 sub agent、CI/CD 编排器或人工执行验证时，都应先读取发布目标，再按目标执行场景验证 loop，最后生成 release evidence 和 release decision。

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
GET /api/v1/loops/{loopId}/sandbox-proof
POST /api/v1/loops/{loopId}/sandbox-proof/verify
GET /api/v1/loop-store
GET /api/v1/loop-observability
GET /api/v1/loop-orchestration/presets
GET /api/v1/loop-orchestration/targets
POST /api/v1/loop-orchestration/advance
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

Dashboard 编排入口通过 `GET /api/v1/loop-orchestration/presets` 返回可用闭环预设，通过 `POST /api/v1/loop-orchestration/instantiate` 创建标准 source-to-production target loop。预设会自动绑定 typed executor graph、`sourceClosure`、Docker sandbox enforcement、worker/watchdog 语义、deploy connector 和 health-ready rollback。

`GET /api/v1/loop-orchestration/targets` 返回按 Sandbox、Context、Harness、Loop 四层组织的 target backlog。每个 target 包含 `status`、`nextAction`、`acceptanceCriteria`、`loopId` 和证据摘要。`POST /api/v1/loop-orchestration/advance` 会选择指定 target 或下一个待推进 target，若没有对应 LoopRun 则创建 Codex-backed target loop；若已有 LoopRun 则根据状态执行 start/resume，遇到 `WAITING_APPROVAL` 时返回 human stop condition，遇到成功但未发布时返回 source-closure next action。

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

- `closureState`: `PLANNED`、`CODE_CHANGED`、`PUSHED`、`TAGGED`、`DEPLOYED`、`HEALTH_READY`、`HEALTH_FAILED`、`ROLLED_BACK`、`PROMOTED` 或 `FAILED`。
- `gateEvidence`: 每个 required gate 的 `PENDING`、`PASSED`、`FAILED` 或 `SKIPPED` 状态和证据。
- `artifacts`: branch、commitSha、pullRequestUrl、mergeRequestUrl、tag、deploymentConnectorId、deploymentId、deploymentUrl、deployStatusUrl、healthUrl、readyUrl、executedAt、executedBy。

响应体还会附带 `sourceReleaseRun`，schema 为 `evopilot-source-release-closure-run/v1`。该运行记录把源码发布闭环提升为可查询的产品资源，包含 provider、releaseStrategy、sourceRef、targetVersion、stages、review、artifacts、capabilities、nextAction 和 status。查询接口：

```http
GET /api/v1/source-release-runs
GET /api/v1/loops/{loopId}/source-release-runs
GET /api/v1/loops/{loopId}/source-closure/plan
```

`source-closure/plan` 会返回该 loop 最新的 release run；如果还没有执行过，则根据当前 `sourceClosure` 生成计划视图。Dashboard 的 Release Closure Runtime 工作台使用这些接口展示阶段、next action、capabilities、source ref 和 artifacts。

Release review 决策接口：

```http
POST /api/v1/loops/{loopId}/source-closure/review-decision
```

请求体：

```json
{
  "action": "approve",
  "commitMessage": "Merge EvoPilot release branch"
}
```

`action` 支持 `approve`、`reject` 和 `merge`。`approve` 会把 release run 的 review stage 标记为 `APPROVED`；`reject` 会标记为 `REJECTED` 并停止 merge next action；`merge` 会要求 release 已批准，除非传入 `force=true`。GitHub 路径调用 PR merge API，GitLab 路径调用 MR merge API，本地目录路径会在 `repository.root` 中切回 `sourceBranch` 并执行 `git merge --no-ff <releaseBranch>`。合并后会写回 `review.status=MERGED`、`artifacts.mergeCommitSha`、`mergedAt`、`mergedBy` 和独立 evidence set。

没有配置 `deployConnectorId` 时，部署 gate 仍兼容旧行为：只记录 `deploymentUrl` 并探测 health/ready URL。配置部署连接器后，deploy gate 必须由连接器真实返回成功才会 `PASSED`。内置连接器类型包括：

- `http-webhook`：调用外部部署系统，由外部系统返回 deployment/probe URL。
- `ecs-docker-compose`：在生产服务器的受限 `workingDir` 中执行 `git rev-parse`、可选 `git pull --ff-only` 和 `docker compose up -d --build`，把部署 commit 和命令输出写入 gate evidence。默认开启部署锁、幂等 stamp 和 compose 失败回滚。

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
  "build": true,
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

执行时可在 `deployParameters.releaseKey` 指定幂等 key；未指定时 EvoPilot 会用 loop、源码 commit、tag 和 target version 生成默认 key。`deployLock=true` 时，同一个 connector 在同一 `workingDir` 中只允许一个部署执行。`rollbackOnFailure=true` 时，`docker compose up` 失败会触发 `git reset --hard <beforeCommit>` 并重新运行 compose，deploy gate 证据会包含 `rollbackStatus`。`rollbackOnHealthFailure=true` 时，compose 发布成功但 health/ready 探测失败会基于 deploy stamp 回滚到发布前 commit，并把 `rollbackStatus`、`rollbackTargetCommit` 和回滚命令输出写入 `health-ready` gate 证据；此时 `closureState` 为 `ROLLED_BACK`，不会被提升为 `PROMOTED`。

K8s/云发布执行器应接入该 deploy connector contract，而不是在 source closure 里硬编码平台逻辑。

剩余 target loop 对应的能力也属于 Loop Runtime 通用模型：

- `persistent-loop-store`：`GET /api/v1/loop-store` 返回当前 store backend、lock provider 和 idempotent replay 恢复语义。默认是 `file`；生产可通过 `EVOPILOT_LOOP_STORE_BACKEND=sqlite|postgres` 和 `EVOPILOT_LOOP_STORE_DSN` 声明 SQLite/Postgres store contract，DSN 会脱敏返回。
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
```

返回追加写入的审计记录，包括项目创建、运行创建、评审决策和交付执行。
