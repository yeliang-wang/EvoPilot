# EvoPilot

> Evidence-driven self-evolution control plane for AI agent products: runtime signals, human-approved code upgrades, CI/CD, and product-native GA release decisions.

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6%2B-3178c6)](https://www.typescriptlang.org/)
[![Runtime](https://img.shields.io/badge/runtime-prod%20by%20default-1f7a8c)](#运行模式)
[![Dashboard](https://img.shields.io/badge/dashboard-中文控制台-1f7a8c)](#控制台)
[![Release](https://img.shields.io/badge/GA%20target-product--native%20GO-2ea043)](#ga-release-target)

EvoPilot observes real AI-agent product behavior, turns evidence into reviewable evolution opportunities, waits for human approval, then drives code upgrades, Jenkins/GitLab delivery, release evidence, and auditable `GO` / `NO-GO` decisions.

It is not an agent runtime, a prompt playground, or a generic code generator. Agent runtimes do the work; EvoPilot governs whether the product is ready to evolve and release.

## Status

EvoPilot has a product-native GA release target and release decision API. The current GA standard is not a health-only soak: the release target requires production-representative projects, successful evolution loops, code-upgrader changes, Jenkins/GitLab delivery, residual scenarios, and active workload stability.

The authoritative release verdict lives in:

```http
GET /api/v1/release/decisions
```

## Core Capabilities

| Capability | What EvoPilot provides |
|---|---|
| Evidence ingestion | Runtime events, OpenTelemetry traces/logs, SkyWalking data, evaluation results, and user feedback. |
| Opportunity discovery | Evidence clustering, failure attribution, dynamic baselines, scorecards, SLOs, and governance rules. |
| Human approval | Markdown evolution proposals that users can review and edit before execution. |
| Code upgrades | A code-upgrader runtime that creates branches, commits implementation changes, and returns review evidence. |
| CI/CD delivery | Jenkins-backed delivery after successful code upgrades, with pipeline status and artifacts retained. |
| Release governance | Product-native release targets, evidence bundles, scenario matrices, risk registers, and release decisions. |

## Quick Start

```bash
npm install
npm run build
npm run server:debug
```

Open the dashboard:

```text
http://127.0.0.1:19876/
```

Debug mode is for local development and UI validation. Production mode is the default for real operation and requires authentication plus real LLM/runtime boundaries.

## GA Release Target

The built-in `ga` release target requires:

| Criterion | Default |
|---|---:|
| Connected production-representative projects | 5 |
| Active successful soak duration | 5400 seconds |
| Active workload run delta | 5 |
| Active code-upgrade delta | 5 |
| Active CI/CD pipeline delta | 5 |
| Successful runs, evolution batches, code upgrades, and pipelines | 5 each |
| Required release scenarios | 10 |

Run the active stability proof:

```bash
npm run release:soak:ga:active
```

Generate release evidence:

```http
POST /api/v1/release/evidence
```

The latest decision can return `GO`, `CONDITIONAL-GO`, or `NO-GO`, with per-criterion evidence.

## GitHub About

Suggested repository description:

```text
Evidence-driven self-evolution control plane for AI agent products: runtime signals, human-approved code upgrades, CI/CD, and product-native GA release decisions.
```

Suggested topics:

```text
ai-agents, agentops, release-governance, evidence, cicd, llmops, self-evolution, typescript
```

## 产品闭环

```text
项目注册
-> 证据上报
-> 证据聚类 / 失败归因 / 动态基线
-> 自学习评测集 / 机会洞察
-> 证据策略触发
-> 评测集沉淀
-> 多评测集形成机会点
-> LLM 生成 Markdown 进化方案
-> 用户查看并修改方案
-> 用户确认进化
-> 代码升级执行器创建分支 / 提交 / MR 或 PR
-> 外部 Jenkins CI/CD 连接器
-> SLO / 成本 / 供应链 / 发布就绪度门禁验证
-> 历史记录 / 审计 / 规则学习
```

## 快速体验

安装依赖并构建：

```bash
npm install
npm run build
```

本地调试模式启动服务：

```bash
npm run server:debug
```

打开控制台：

```text
http://127.0.0.1:19876/
```

调试模式用于本地开发和页面验证，会允许样例数据、模板兜底和本地模拟集成。生产模式不要使用 `server:debug`。

## 控制台

Dashboard 位于 `apps/dashboard/`，当前一级菜单包括：

| 菜单 | 用途 |
|---|---|
| 首页 | 展示 APM 风格进化观测图，查看接入项目与证据流拓扑。 |
| 接入项目 | 注册 GitLab、GitHub 或本地 Git 项目，查看项目成熟度 Scorecard，验证通过后进入下游流程。 |
| 证据策略 | 用自然语言定义进化触发规则，系统编译并落盘为 Markdown。 |
| 评测集 | 查看线上证据沉淀出的 Eval Dataset / Regression Suite，并多选形成机会点。 |
| 机会点 | 查看触发来源、策略、项目、IP、证据摘要、置信度、失败归因、治理等级和可编辑 Markdown 方案。 |
| 流水线 | 查看用户确认后的代码升级白盒过程，以及成功后的 CI/CD 阶段。 |
| 历史记录 | 查看已完成演进、验证证据、产物和执行链路。 |

首页还会展示平均服务分、SLO 健康、错误预算、失败策略、供应链风险、运行时就绪、成本健康、发布就绪、发布阻断、灰度就绪和灰度阻断。供应链风险和运行时就绪来自 `runtimes/runtime-lock.json`，成本健康来自运行证据中的 `costUsd`、`totalTokens`、`inputTokens`、`outputTokens` 等字段，发布就绪度来自 `/api/v1/release/readiness`，灰度策略来自 `/api/v1/rollout/strategies`。

也可以只打开静态控制台：

```bash
npm run dashboard
```

静态打开时会使用页面内置示例数据；连接服务端时会读取真实 API。

## 进化证据接入

EvoPilot 当前支持 6 类证据接入方式。

| 接入方式 | 接口 | 说明 |
|---|---|---|
| 通用事件 / SDK | `POST /api/v1/evidence/events` | Agent、工具、LLM、RAG、路由、工作流等自定义证据。 |
| OpenTelemetry Trace | `POST /api/v1/evidence/otlp/v1/traces` | 接收 OTLP JSON Trace，提取 span、traceId、耗时和 GenAI 属性。 |
| OpenTelemetry Log | `POST /api/v1/evidence/otlp/v1/logs` | 接收 OTLP JSON Log，将错误日志转换为进化证据。 |
| SkyWalking | `POST /api/v1/evidence/skywalking` | 接收 SkyWalking 链路或查询结果转换后的 JSON。 |
| 评测结果 | `POST /api/v1/evidence/evaluations` | 接收 Eval、Regression Suite、语义测试或 CI 回归结果。 |
| 用户反馈 | `POST /api/v1/evidence/feedback` | 接收差评、投诉、满意度、人工标注等反馈。 |

EvoPilot 不替代 SkyWalking、Prometheus、Tempo 或日志平台。EvoPilot 负责把这些可观测性信号转化为产品进化机会，并进入可验证交付闭环。

详细说明见 [docs/evidence-ingestion.md](docs/evidence-ingestion.md)。

## 项目接入

项目必须先注册并验证通过，才能进入证据策略、机会点和流水线。

支持的项目来源：

- `local-git`：本地 Git 仓库。
- `gitlab`：GitLab 仓库。
- `github`：GitHub 仓库。

Dashboard 注册弹窗会要求填写 Git URL、本地目录、默认分支、用户名、密码、Token 或 Token 环境变量。凭据只用于验证和后续代码升级闭环，API 响应不会明文返回敏感字段。

## LLM 能力

EvoPilot 的 LLM Gateway 已对齐 `domainforge-fabric-llm` 的通用能力，包括：

- OpenAI-compatible Chat Completions 调用。
- intent / profile 路由。
- thinking profile。
- 长上下文压缩。
- 输出截断后的 token 放大重试。
- provider、model、token、耗时和压缩 trace。
- LLM metrics JSONL。
- 密钥脱敏。

当前强制使用真实 LLM 的产品链路：

| 链路 | 作用 |
|---|---|
| `POST /api/v1/rules/compile` | 将用户 Prompt 编译为系统执行规则，并写入 Markdown。 |
| `POST /api/v1/opportunity-drafts` | 将多个评测集生成可编辑 Markdown 进化方案。 |

默认 LLM 配置文件：

```text
data/evopilot/llm.env
```

生产模式下，LLM 未配置、调用失败或返回格式不合法都会阻断流程；只有 `EVOPILOT_RUN_MODE=debug` 才允许模板兜底。

证据策略编译会做二次语义校验。比如“所有链路调用小于 3 秒”代表目标状态，执行触发条件必须是超过 3000ms 的风险信号；如果 LLM 把它错误编译成 `durationMs <= 3000`，系统会拒绝落盘和执行该规则。

## 运行模式

EvoPilot 默认以生产模式启动。

```bash
npm run server
```

生产模式要求：

- 必须配置 `EVOPILOT_TOKENS` 或 `EVOPILOT_API_TOKEN`。
- `EVOPILOT_REQUIRE_LLM` 默认是 `true`。
- 不允许匿名 admin。
- 不允许模拟集成链路。
- 不自动注册内置项目画像。
- 不开放样例评测集。

本地调试必须显式启动：

```bash
npm run server:debug
```

常用环境变量：

| 变量 | 说明 |
|---|---|
| `EVOPILOT_RUN_MODE` | 运行模式，默认 `prod`；本地调试使用 `debug`。 |
| `EVOPILOT_PORT` | HTTP 端口，默认 `19876`。 |
| `EVOPILOT_HOST` | 监听地址，默认 `127.0.0.1`。 |
| `EVOPILOT_DATA_ROOT` | 持久化目录，默认 `data/evopilot`。 |
| `EVOPILOT_TOKENS` | 多 Token 配置，格式为 `name:token:role`。 |
| `EVOPILOT_API_TOKEN` | 单一管理员 Bearer Token。 |
| `EVOPILOT_DASHBOARD_ROOT` | Dashboard 静态资源目录，默认 `apps/dashboard`。 |
| `EVOPILOT_LLM_ENV_FILE` | LLM 配置文件路径，默认 `data/evopilot/llm.env`。 |
| `EVOPILOT_LLM_BASE_URL` | OpenAI-compatible LLM 服务地址。 |
| `EVOPILOT_LLM_MODEL_NAME` | 模型名称。 |
| `EVOPILOT_LLM_API_KEY` | 模型服务密钥。 |
| `EVOPILOT_CODE_UPGRADER_BASE_URL` | EvoPilot 代码升级托管运行时地址。 |
| `EVOPILOT_PRODUCT_JENKINS_BASE_URL` | 外部 Jenkins 系统默认连接器地址；项目可在注册时配置独立 Jenkins 覆盖。 |

完整部署说明见 [docs/deployment.md](docs/deployment.md)。

## Docker

构建镜像：

```bash
docker build -t evopilot:0.1.0 .
```

运行容器：

```bash
docker run --rm \
  -p 19876:19876 \
  -e EVOPILOT_TOKENS='admin:change-me-admin-token:admin,operator:change-me-operator-token:operator,viewer:change-me-viewer-token:viewer' \
  -v evopilot-data:/var/lib/evopilot \
  evopilot:0.1.0
```

或使用 Docker Compose：

```bash
docker compose up --build
```

## 构建与测试

```bash
npm run build
npm run test:unit
npm run test:smoke
npm run test:functional
npm run test:e2e
```

完整检查：

```bash
npm run check
```

真实 LLM E2E：

```bash
npm run test:e2e:real-llm
```

真实生产链路 E2E：

```bash
npm run test:e2e:production
```

真实生产链路不会降级为模拟执行。缺少真实代码升级执行器、外部 Jenkins CI/CD 连接器、真实项目配置或真实 LLM 时，测试会失败或以阻断状态结束。

## 仓库结构

```text
apps/dashboard/                         EvoPilot 中文控制台
packages/core/                          生命周期、证据、计划、评审、交付核心模型
packages/server/                        控制平面 API 与 Dashboard 静态服务
packages/llm/                           LLM Gateway、路由、压缩、metrics
packages/profile-domainforge-fabric/    domainforge-fabric 项目画像
packages/adapter-gitlab/                GitLab 适配器
packages/adapter-github/                GitHub 适配器
packages/adapter-local-git/             本地 Git 适配器
packages/adapter-jenkins/               外部 CI/CD / Jenkins 连接器边界
docs/                                   用户、API、部署、证据接入和测试文档
examples/                               最小接入示例
scripts/                                真实 LLM、生产 E2E、运行时锁定和发布校验脚本
runtimes/                               EvoPilot 托管运行时镜像、锁定和供应链材料
tests/                                  单元、烟测、功能和 E2E 测试
```

## 文档

- [用户操作手册](docs/user-guide.md)
- [API 文档](docs/api.md)
- [OpenAPI 描述](docs/openapi.json)
- [进化证据接入手册](docs/evidence-ingestion.md)
- [部署说明](docs/deployment.md)
- [生产用户 E2E 场景](docs/production-user-e2e.md)
- [测试说明](docs/testing.md)
- [生命周期说明](docs/lifecycle.md)
- [产品 Review](docs/product-review.md)

## 与 SkyWalking 的关系

EvoPilot 可以接收 SkyWalking 链路或查询结果转换后的 JSON，但 EvoPilot 不替代 SkyWalking。

推荐组合方式：

```text
SkyWalking / OpenTelemetry / 日志平台 / Eval / 用户反馈
-> EvoPilot 进化证据接入层
-> 证据策略
-> 机会点
-> 代码升级
-> CI/CD
-> 历史记录与审计
```

SkyWalking 更关注服务观测、链路追踪和诊断；EvoPilot 更关注如何把这些证据变成 AI Agent 产品的可控进化。

## 当前状态

EvoPilot 已具备可运行的产品闭环代码、中文 Dashboard、真实 LLM 链路、证据接入层、项目注册、代码升级执行边界、外部 Jenkins CI/CD 连接器边界和测试套件。

发布到生产环境前，至少需要完成：

- 为目标环境配置真实 `EVOPILOT_TOKENS`。
- 配置真实 LLM。
- 配置真实项目接入凭据。
- 配置或启动代码升级执行器。
- 配置系统默认 Jenkins，或在项目注册时配置项目独立 Jenkins。
- 通过 `npm run check` 和 `npm run test:e2e:production`。

## 许可证

EvoPilot 使用 Apache License 2.0 开源。详见 [LICENSE](LICENSE)。
