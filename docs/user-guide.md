# EvoPilot 用户操作手册

## 操作总览

EvoPilot 的日常使用不是“调用一次 agent”，而是把真实 AI Agent 产品放进一个可持续推进长任务的工程框架。用户操作时可以按四层理解：

| 层级 | 用户需要确认什么 | 在 EvoPilot 里看哪里 |
|---|---|---|
| Sandbox | 执行器是否在受控边界里修改代码、运行验证和触发 CI/CD。 | 流水线、代码升级记录、artifacts、受保护路径和验证命令 |
| Context | 每轮证据、方案、产物和中间结果是否能追踪。 | timeline、evidence sets、历史记录、项目画像、评测集 |
| Harness | 权限、审批、审计、恢复和停止条件是否生效。 | 评审页、审计记录、watchdog、retry/stop policy、结构化日志 |
| Loop | 任务是否应该继续、暂停、转人工或形成发布判断。 | Loop 状态、release decision、`GO` / `CONDITIONAL-GO` / `NO-GO` |

用户需要关注四个问题：

- 证据是否来自真实项目和真实运行边界。
- 方案是否经过人工确认，且修改范围清楚。
- 执行是否留下 timeline、artifacts、代码升级和 CI/CD 证据。
- 最终是否由 release decision 给出可审计结论，而不是只看健康检查、单次 CI 成功或 executor 自报成功。

## 1. 注册项目

进入 Dashboard 的“接入项目”，点击“注册项目”。

填写：

- 项目 ID
- 项目名称
- 接入方式：本地 Git、GitLab 或 GitHub
- Git URL 或本地目录
- 默认分支
- 用户名、密码、Token 或 Token 环境变量

EvoPilot 会先验证仓库可访问。验证通过后，项目才会进入证据策略、机会点和流水线流程。

## 2. 定义证据策略

进入“证据策略”，用自然语言输入规则，例如：

```text
所有链路调用小于 3 秒
```

EvoPilot 会使用 LLM 编译为系统执行规则，并以 Markdown 存储到：

```text
<EVOPILOT_DATA_ROOT>/rules/*.md
```

管理员可以打开 Markdown 查看执行规则。

生产模式下，编译结果必须通过系统语义校验才会落盘并执行。比如“所有链路调用小于 3 秒”是用户目标，真正触发演进的条件应该是链路耗时大于 3000ms；如果 LLM 错误返回 `durationMs <= 3000`，EvoPilot 会拒绝该规则，避免把正常状态当成风险触发。

用户不定义规则时，项目也不会停止进化。EvoPilot 内置系统默认规则，会自动覆盖以下生产信号：

- 链路延迟、性能热点。
- 工具失败和恢复失败。
- RAG 未命中或质量退化。
- Eval Dataset / Regression Suite 回归失败。
- 用户负反馈。
- LLM 成本和 Token 预算风险。
- 安全风险。
- 发布失败、灰度失败或回滚。
- 上下文压缩、Prompt 版本和 Memory 风险。

## 3. 上报进化证据

项目运行后，可以通过以下方式接入证据：

- 通用事件 / SDK：`POST /api/v1/evidence/events`
- OpenTelemetry Trace：`POST /api/v1/evidence/otlp/v1/traces`
- OpenTelemetry Log：`POST /api/v1/evidence/otlp/v1/logs`
- SkyWalking：`POST /api/v1/evidence/skywalking`
- 评测结果：`POST /api/v1/evidence/evaluations`
- 用户反馈：`POST /api/v1/evidence/feedback`

例如上报一次链路超时：

```json
{
  "projectId": "domainforge-fabric",
  "events": [
    {
      "type": "agent.step",
      "message": "链路响应超过目标",
      "traceId": "trace-001",
      "attributes": {
        "durationMs": 3500
      }
    }
  ]
}
```

如果命中证据策略，EvoPilot 会生成机会点。

## 4. 选择评测集并形成机会点

进入“评测集”，选择一个或多个评测集，点击“形成机会点”。

一个机会点可以由多个评测集组成，例如：

- 链路延迟回归集
- 用户负反馈评测集
- 工具失败评测集
- 语义回归套件

## 5. 查看和编辑进化方案

进入“机会点”，点击“查看方案”。

EvoPilot 生成方案前会读取当前项目注册的 Git 基线代码，并把代码事实、项目运行配置、关联评测集和目标约束一起交给软件架构师能力分析。系统必须先判断目标是否可达，例如“所有调用链路小于 3 秒”是否能由当前代码结构支撑；如果目标明显不可达，方案必须给出不可达原因或阶段化目标，不能直接生成空泛改造建议。

方案以 Markdown 显示。用户可以直接编辑方案，提交后以当前 Markdown 作为后续执行依据。

## 6. 确认进化

在方案页点击“确认进化”。

确认后 EvoPilot 会创建执行任务：

```text
代码升级 -> 外部 Jenkins CI/CD
```

只有代码升级成功后才会进入 CI/CD。代码升级失败时流程停止，并保留失败证据。

生产模式下，代码升级成功必须包含真实项目实现、测试、脚本或配置文件变更。`.evopilot/upgrades` 是审计证据，`.evopilot/runtime-upgrades` 是升级执行契约，`docs/evopilot-upgrades` 是升级说明；仅修改这些文件不能触发 CI/CD。

## 7. 查看流水线

进入“流水线”。

可以看到：

- 代码升级白盒过程
- 升级分支
- 提交 SHA
- 合并请求地址
- CI/CD 阶段
- 构建日志摘要
- 发布证据

## 8. 查看历史记录

进入“历史记录”。

这里展示已经完成的进化，包括：

- 机会点来源
- 进化方案
- 代码升级结果
- CI/CD 结果
- 发布报告
- 审计记录

## 9. 使用长任务 Loop

当一个目标不能在一次方案生成或一次代码升级中完成时，可以把它作为长任务 Loop 推进。用户不需要理解 executor graph 的内部结构，但需要按 `Sandbox / Context / Harness / Loop` 检查它是否真正可持续、可恢复、可审计。

适合使用 Loop 的场景：

- 一个机会点需要多轮代码升级、验证和修复。
- 发布目标需要持续收集运行证据、CI/CD 证据和风险矩阵。
- 任务来自 Codex、IM、定时任务、运行时信号或 release target，不适合手工一步步推进。
- 执行过程中可能出现失败、重试、暂停、审批或转人工。

典型操作路径：

1. 通过 Dashboard 的“Loop > 闭环编排”、API、Codex 或 IM 入口创建目标。
2. 在 timeline 中查看每一轮执行、证据、失败签名、重试和 watchdog 恢复记录。
3. 对高风险方案、发布动作或 release action 做人工审批。
4. 查看 evidence sets、artifacts、代码升级结果和 CI/CD 结果。
5. 根据最终 `GO` / `CONDITIONAL-GO` / `NO-GO` 决策继续、暂停、修复或发布。

常用 API 入口：

```http
POST /api/v1/loops
POST /api/v1/loops/{loopId}/start
POST /api/v1/loops/{loopId}/resume
POST /api/v1/loops/{loopId}/approve
GET /api/v1/loops/{loopId}/timeline
GET /api/v1/loops/{loopId}/evidence
GET /api/v1/loops/{loopId}/artifacts
```

用户判断一个 Loop 是否健康时，应优先看：

- Sandbox：执行是否发生在受控 workspace、代码升级执行器和 CI/CD 边界内。
- Context：timeline 是否能解释每一轮为什么继续、停止或等待审批。
- Context：evidence sets 是否来自独立验证，而不是 executor 自报成功。
- Harness：watchdog、retry/stop policy 和 approval gate 是否阻断了重复失败、超时或高风险动作。
- Loop：release decision 是否明确给出 `GO` / `CONDITIONAL-GO` / `NO-GO`，或明确路由给人工处理。

Loop Runtime 负责长任务连续性：durable run state、heartbeat lease、watchdog、retry/stop policy、timeline 和 artifacts。EvoPilot 的产品控制面负责证据、决策、治理和发布判断。

Dashboard 的“闭环编排”会调用 `POST /api/v1/loop-orchestration/instantiate`，从标准预设创建 source-to-production target loop。该 loop 会自动带上 typed executor graph、Docker sandbox enforcement、sourceClosure、worker/watchdog 语义、deploy connector 和 health-ready rollback。创建后，用户可以在同一页启动、继续、批准、watchdog、执行源码闭环，并查看 Source Closure Workbench 和 Release Artifacts。

同一页面的 Target Loop Backlog 对应 `GET /api/v1/loop-orchestration/targets` 和 `POST /api/v1/loop-orchestration/advance`。它把后续产品进化目标按 Sandbox、Context、Harness、Loop 四层排队，记录 acceptance criteria、next action、stop condition 和证据摘要；点击“推进下一 Target”时，EvoPilot 会创建或推进 Codex-backed target loop，而不是要求用户每次手工复制命令或重新描述上下文。

### 9.1 EvoPilot 自托管改进 Loop

EvoPilot 可以把当前 EvoPilot 仓库或远程 EvoPilot 仓库作为被治理的目标项目接入自身控制面。这个入口用于形成受控的自举 loop，而不是让运行中的 controller 直接自我修改。

启动控制面后执行：

```bash
EVOPILOT_API_TOKEN=<admin-token> npm run self-loop
```

该命令会完成三件事：

- 注册 `evopilot-self` 项目，并通过现有项目验证。
- 上报一条关于 `ExecutorAdapter` 合同缺口的真实 evidence event。
- 创建 `evopilot-self-executor-adapter-contract` loop，并把 `allowedPaths`、`validationCommands`、`nonGoals` 和 `approvalRequired` 写入 loop context。

默认行为不会改代码、不会启动代码升级执行器、不会 merge/tag/push，也不会发布 GA 结论。如果需要只推进一轮 Loop Runtime 迭代用于生成 timeline 和 evidence，可显式开启：

```bash
EVOPILOT_API_TOKEN=<admin-token> EVOPILOT_SELF_LOOP_START=1 npm run self-loop
```

操作者应在 loop context 中检查边界，再用 `npm run loop-runtime:check`、`npm run check` 和 `git diff --check` 验证后续实现。

生产服务器管理 EvoPilot 自身时，不应注册操作者 Mac 上的 `/Users/.../EvoPilot` 路径，因为 `local-git` 验证发生在服务器端。应注册 GitHub 或 GitLab 远程仓库：

```bash
EVOPILOT_BASE_URL=https://evopilot.example.com \
EVOPILOT_API_TOKEN=<admin-token> \
EVOPILOT_SELF_REPOSITORY_PROVIDER=github \
EVOPILOT_SELF_GITHUB_OWNER=yeliang-wang \
EVOPILOT_SELF_GITHUB_REPO=EvoPilot \
EVOPILOT_SELF_GITHUB_TOKEN_REF=GITHUB_TOKEN \
npm run self-loop
```

其中 `GITHUB_TOKEN` 必须存在于 EvoPilot 服务器环境中，供服务器验证远程仓库。

GitLab 项目同样支持：

```bash
EVOPILOT_BASE_URL=https://evopilot.example.com \
EVOPILOT_API_TOKEN=<admin-token> \
EVOPILOT_SELF_REPOSITORY_PROVIDER=gitlab \
EVOPILOT_SELF_GITLAB_BASE_URL=https://gitlab.example.com \
EVOPILOT_SELF_GITLAB_PROJECT_ID=group/EvoPilot \
EVOPILOT_SELF_GITLAB_TOKEN_REF=GITLAB_TOKEN \
npm run self-loop
```

接入后，Dashboard 的 Loop Runtime 表格和详情工作台会显示 `sourceClosure.closureState`、required gates、branch、commit、PR/MR、tag、deployment、health/ready、rollback、typed graph、sandbox enforcement 和 worker/watchdog 证据。管理员可以点击“执行闭环”，或调用 `POST /api/v1/loops/{loopId}/source-closure/execute`，由 EvoPilot 对 GitHub/GitLab 执行分支、提交、PR/MR、Tag、deploy connector 和 health/ready gate 探测。

自动部署应先注册部署连接器：

```http
POST /api/v1/connectors/deploy
```

当前内置两类部署连接器：

- `http-webhook`：EvoPilot 会把 loop、源码、branch、commit、tag、PR/MR 和环境参数发送给部署系统，由部署系统返回 `deploymentId`、`deploymentUrl`、`healthUrl` 和 `readyUrl`。
- `ecs-docker-compose`：EvoPilot 在配置的服务器 `workingDir` 内执行受限发布序列，先读取当前 commit，可选执行 `git pull --ff-only <remote> <branch>`，再执行 `docker compose -f <composeFile> up -d --build [serviceName]`，并把每条命令的退出码和截断输出写入 deploy gate 证据。该连接器默认启用 `deployLock`、`idempotency`、`rollbackOnFailure` 和 `rollbackOnHealthFailure`：同一 release key 不重复执行 compose，compose 失败或发布后 health/ready 探测失败时会回到发布前 commit 并重新启动 compose。

Dashboard 会在“接入项目”页展示部署连接器列表；执行闭环时，如果 loop 已绑定 `deploymentConnectorId` 或生产环境只有一个部署连接器，会自动携带该连接器。

## 10. 角色权限

| 角色 | 能力 |
|---|---|
| `viewer` | 查看项目、运行、机会点、流水线、历史和审计。 |
| `operator` | 上报证据、编译规则、创建机会点、提交评审决策。 |
| `admin` | 注册项目、配置连接器、触发代码升级和交付。 |
