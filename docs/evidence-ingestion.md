# 进化证据接入手册

## 目标

EvoPilot 的证据接入层负责把线上 Agent、工具调用、LLM 调用、RAG、评测、用户反馈、APM 链路和日志统一转换为进化证据。所有接入方式最终都会进入同一个闭环：

```text
证据上报 -> 证据包 -> 证据聚类 -> 失败归因 -> 触发规则 -> 机会点 -> 用户确认 -> 代码升级 -> GitHub Actions/GitLab CI -> 历史记录
```

## 接入方式

### 通用事件接入

用于 Java、Node、Python 或其他系统的轻量 SDK / 探针直接上报。

```http
POST /api/v1/evidence/events
```

请求示例：

```json
{
  "projectId": "domainforge-fabric",
  "events": [
    {
      "type": "agent.step",
      "message": "订单助手链路响应超过目标",
      "traceId": "trace-001",
      "module": "order-agent",
      "attributes": {
        "durationMs": 3500,
        "promptVersion": "v12",
        "toolName": "order-search"
      }
    }
  ],
  "files": [
    "runtimes/order-agent/src/main/java"
  ]
}
```

### OpenTelemetry Trace 接入

用于接收兼容 OTLP JSON 的 Trace 数据。EvoPilot 会提取 span、traceId、service.name、耗时、GenAI 属性并转换为运行证据。

```http
POST /api/v1/evidence/otlp/v1/traces?projectId=<项目ID>
```

支持的关键字段：

- `resourceSpans[].resource.attributes`
- `scopeSpans[].spans[]`
- `traceId`
- `spanId`
- `name`
- `startTimeUnixNano`
- `endTimeUnixNano`
- `attributes`

当 span 属性包含 `gen_ai.system` 或 `gen_ai.operation.name` 时，EvoPilot 会把它识别为 LLM / Agent 相关证据。

### OpenTelemetry Log 接入

用于接收兼容 OTLP JSON 的日志数据。

```http
POST /api/v1/evidence/otlp/v1/logs?projectId=<项目ID>
```

`ERROR` 日志会转换为高严重级别证据，可用于失败归因和机会点触发。

### SkyWalking 接入

用于接收 SkyWalking 链路或查询结果转换后的 JSON。EvoPilot 当前实现为轻量适配层，不替代 SkyWalking 后端。

```http
POST /api/v1/evidence/skywalking
```

请求示例：

```json
{
  "projectId": "domainforge-fabric",
  "spans": [
    {
      "traceId": "sw-trace-001",
      "spanId": "span-001",
      "serviceName": "order-agent",
      "endpointName": "/chat",
      "latency": 3600
    }
  ]
}
```

### 评测结果接入

用于外部评测系统、回归套件或 CI 语义测试上报。

```http
POST /api/v1/evidence/evaluations
```

请求示例：

```json
{
  "projectId": "domainforge-fabric",
  "results": [
    {
      "suite": "latency-regression",
      "caseId": "order-chat-p95",
      "status": "FAILED",
      "score": 0.42,
      "message": "p95 延迟超过 3 秒"
    }
  ]
}
```

### 用户反馈接入

用于接收用户差评、投诉、满意度和人工标注。

```http
POST /api/v1/evidence/feedback
```

请求示例：

```json
{
  "projectId": "domainforge-fabric",
  "feedback": [
    {
      "rating": "negative",
      "message": "回答太慢",
      "traceId": "trace-001",
      "userId": "user-001"
    }
  ]
}
```

## 鉴权

所有 `/api/v1/evidence/*` 接口都需要 `operator` 或更高角色：

```text
Authorization: Bearer <operator-token>
```

## 触发规则字段

当前规则引擎会直接识别以下字段：

- `type`
- `source`
- `severity`
- `module`
- `attributes.durationMs`
- `attributes.latencyMs`
- `attributes.p95LatencyMs`
- `attributes.costUsd`
- `attributes.totalTokens`
- `attributes.ragHit`
- `attributes.score`
- `attributes.errorRate`
- `attributes.rollbackCount`
- `attributes.contextTruncated`

例如用户规则“所有链路调用小于 3 秒”会被编译为 `durationMs`、`latencyMs` 或 `p95LatencyMs` 大于 `3000` 时触发性能优化机会点。

生产模式下，LLM 编译后的规则必须通过系统语义校验才会写入 Markdown 并参与执行。校验会阻断以下情况：

- 把“小于 3 秒”的用户目标错误编译为 `durationMs <= 3000` 这类正常状态触发条件。
- 把 RAG、工具失败、上下文截断等语义错误塞进耗时字段。
- 耗时、成本、Token、评分、错误率、回滚数等字段使用非数值阈值。
- `ragHit`、`contextTruncated` 等布尔字段使用非 `true` / `false` 值。
- `allOf` 条件存在明显互相矛盾的判断。

已落盘的 Markdown 规则在服务启动和运行读取时也会再次校验。无效规则不会参与执行；同 ID 的有效用户规则会覆盖系统默认规则。

## 系统默认自进化规则

即使用户没有在 Dashboard 定义任何证据策略，EvoPilot 也会启用一组系统默认规则，保证接入项目仍然可以基于主流 AI Agent 生产信号形成机会点：

| 规则 | 触发信号 | 机会类型 |
|---|---|---|
| 链路耗时超过 3 秒 | `durationMs`、`latencyMs`、`p95LatencyMs` 大于 3000ms | 性能热点 |
| 性能或延迟信号 | 事件类型包含 `performance` 或 `latency` | 性能热点 |
| 产品能力缺口信号 | 事件类型包含 `product-gap` | 产品缺口 |
| 工具失败信号 | 事件类型包含 `tool.failure` 或 `tool-failure` | 工具恢复 |
| 成本预算风险 | `costUsd >= 0.5`、`totalTokens >= 8000` 或成本事件 | 成本优化 |
| RAG 质量退化 | `ragHit=false` 或 RAG 相关事件 | 可靠性风险 |
| 评测回归失败 | `eval.failed`、`eval.error` 或 `score < 0.7` | 测试缺口 |
| 负向用户反馈 | `user.feedback.negative` | 产品体验 |
| 安全风险信号 | `security` 事件或 `CRITICAL` 严重级别 | 安全风险 |
| 发布后回归或回滚 | CI/CD、发布、灰度、回滚失败信号 | 发布流程风险 |
| 上下文压缩风险 | `contextTruncated=true`、Prompt 或 Memory 风险事件 | 上下文治理 |

## 证据到机会点的判断逻辑

EvoPilot 不会把每条证据都直接变成一个机会点。系统会先做证据聚类，再判断是否形成稳定机会：

- 优先按 `traceId` 聚合，把同一次线上调用中的 Trace、Log、Tool Call、评测失败和用户反馈合并为同一个证据簇。
- 没有 `traceId` 时，按模块、来源和事件类型族聚合，避免单点噪声直接触发演进。
- 每个证据簇会计算动态基线，例如最大链路耗时、失败评测数量、高严重级别事件数量。
- 系统会给出失败归因，例如链路性能退化、工具恢复失败、RAG 质量漂移、评测回归失败、用户体验下降、成本退化或安全风险。
- 多个证据来源互相印证时，机会点置信度会提升；只有单条低严重级别信号时，不会形成机会点。
- 多条规则命中同一类型和同一影响域时，会合并为一个机会点，并保留命中的规则、证据簇和判断依据。

## 自学习评测集

当运行证据形成机会点后，EvoPilot 会自动沉淀 Eval Dataset：

- 每个机会点会生成一个系统智能沉淀评测集，记录关联证据、机会点、置信度、失败归因和动态基线。
- Dashboard 的评测集页面会展示“学习方式”，区分“智能沉淀”和“人工导入”。
- `/api/v1/opportunity-insights` 会基于机会点、评测集和发布后学习记录生成机会洞察，用于后续智能排序。

## 产品边界

EvoPilot 不是 APM 系统，不替代 SkyWalking、Prometheus、Tempo 或日志平台。EvoPilot 做的是进化证据控制面：

- 接收 APM / Trace / Log / Metrics / Eval / Feedback。
- 转换为统一进化证据。
- 触发进化规则和机会点。
- 驱动代码升级与 GitHub Actions/GitLab CI 原生 DevOps。

APM 系统继续负责底层采集、存储、拓扑和排障；EvoPilot 负责把这些信号转化为可执行的产品进化闭环。
