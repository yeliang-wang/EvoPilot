# 进化证据接入手册

## 目标

EvoPilot 的证据接入层负责把线上 Agent、工具调用、LLM 调用、RAG、评测、用户反馈、APM 链路和日志统一转换为进化证据。所有接入方式最终都会进入同一个闭环：

```text
证据上报 -> 证据包 -> 触发规则 -> 机会点 -> 用户确认 -> 代码升级 -> 产品托管 CI/CD -> 历史记录
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

例如用户规则“所有链路调用小于 3 秒”会被编译为 `durationMs`、`latencyMs` 或 `p95LatencyMs` 大于 `3000` 时触发性能优化机会点。

## 产品边界

EvoPilot 不是 APM 系统，不替代 SkyWalking、Prometheus、Tempo 或日志平台。EvoPilot 做的是进化证据控制面：

- 接收 APM / Trace / Log / Metrics / Eval / Feedback。
- 转换为统一进化证据。
- 触发进化规则和机会点。
- 驱动代码升级与产品托管 CI/CD。

APM 系统继续负责底层采集、存储、拓扑和排障；EvoPilot 负责把这些信号转化为可执行的产品进化闭环。
