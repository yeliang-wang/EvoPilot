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
  "version": "0.1.0",
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

## 审计

```http
GET /api/v1/audit
```

返回追加写入的审计记录，包括项目创建、运行创建、评审决策和交付执行。
