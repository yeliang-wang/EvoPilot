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

## Field Evidence Kit

EvoPilot 内置 Field Evidence Kit，用于把第一次使用和公开演示变成可复现的 Source-to-GA 样例，而不是一次性截图或假数据。

| 类型 | 内容 | 位置 | 是否产品能力 |
|---|---|---|---|
| Product Kit | GitHub demo project 预填、sample evidence 导入、GitHub workflow 模板、ExecutorAdapter 示例、case study 模板 | Dashboard、`examples/`、`docs/case-studies/`、`docs/comparisons/` | 是，长期保留 |
| Evidence Output | 某次运行生成的 loopId、release decision JSON、trace、截图、soak report、audit evidence | `evidence/production-soak/` 或发布证据包 | 否，是运行归档 |

第一次 Source-to-GA 推荐使用 Dashboard 的“主链路向导”。向导会把下面步骤串成一个页面，用户只需要按当前步骤点击“进入”：

1. 在“主链路向导”进入“连接 GitHub 项目”，打开 Field Evidence Kit，预填 GitHub demo project 表单并提交。提交后仍然调用 `/api/v1/projects`。
2. 回到向导进入“确认 GA 目标”，导入 sample evidence。导入后仍然调用 `/api/v1/evidence/events`，并自动生成 evidence run 与评测集。
3. 运行 Discovery，形成 Target Backlog。
4. 回到向导进入“启动 Loop 写回代码”，在“Loop 执行”默认页查看当前 Loop、下一步和 Source-to-GA 状态；需要 trace、replay、sandbox 或 Workflow Canvas 时再打开高级控制台。
5. 回到向导进入“查看发布结论”，在“评估与发布”先读取 `GO` / `CONDITIONAL-GO` / `NO-GO`、PR、merge commit、post-merge deploy 和下一步动作；需要完整 evidence matrix、repair 或 deploy finalizer 时再打开高级视图。
6. 把本次产生的截图、loopId、release decision 和 soak report 归档为 Evidence Output。

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

1. 第一次使用时通过 Dashboard 的“主链路向导”创建或进入 Source-to-GA 目标。
2. 在“Loop 执行”默认页先看当前 Loop、待处理 Loop 和历史 Loop，确认下一步动作。
3. 需要排查时再打开高级控制台，在 timeline 中查看每一轮执行、证据、失败签名、重试和 watchdog 恢复记录。
4. 对高风险方案、发布动作或 release action 做人工审批。
5. 在“评估与发布”先看发布结论，再按需查看 evidence sets、artifacts、代码升级结果和 CI/CD 结果。
6. 根据最终 `GO` / `CONDITIONAL-GO` / `NO-GO` 决策继续、暂停、修复或发布。

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

Dashboard 的“闭环编排”会调用 `POST /api/v1/loop-orchestration/instantiate`，从标准预设创建 source-to-production target loop。该 loop 会自动带上 typed executor graph、Docker sandbox enforcement、sourceClosure、worker/watchdog 语义、deploy connector 和 health-ready rollback。Loop 执行页拆成三个工作区：`总览` 只放 Target Backlog、Loop Runtime 列表和 Worker Queue 摘要；`Loop 详情` 只放当前 loopId 的 Source-to-GA 动态链路、Interactive Run Console、trace、replay、sandbox 和 release evidence；`创建 Loop` 只放闭环编排和 Workflow Canvas Editor。真实验收时不要只截取 Loops 总览页，必须点击目标行的“打开 Loop 详情”，确认截图里能看到当前 `loopId`、项目、Human Gate、LLM provider/model/tokens、trace 或 release evidence。Release Closure Runtime 还提供“批准 Release”“合并 Release”和“安全自动合并”，用于把 PR/MR 或本地 release branch 的审批、策略门禁、merge、post-merge deploy 证据写回 release run。

Loop 详情页的 Source-to-GA 动态本体链路图用于快速判断“从源码到 GA”卡在哪一类边界。读图顺序是：

1. `SCM / Git Project`：确认项目、仓库、默认分支和源码写回凭据是否可用。
2. `Discovery Candidate`：确认 trace、evaluation、production 或 manual signal 是否已经形成候选证据。
3. `Target Backlog`：确认目标、项目和 stop condition 是否是当前要推进的 GA 或发布目标。
4. `Executor Graph`：确认 typed graph 是否已经入库，是否带条件路由、fan-out/fan-in、人审和 release gate。
5. `Worker + Sandbox`：确认 loop 是否已被 worker claim，代码升级、CI/CD、验证命令、凭据、网络和路径边界是否被执行或至少有 policy proof。
6. `Human Gate`：确认当前是否等待批准继续、批准 Release 或结束最终 gate。`WAITING_APPROVAL` 是正常 Human Gate，表示系统按治理规则停下等待人工批准，不等同于超时、失败或 worker 未运行。
7. `Source Closure`：确认 branch、commit、PR/MR、tag、required gates 和 artifacts 是否已经进入 source release run。
8. `CI/CD + Deploy`：确认 Jenkins/deploy connector、post-merge deploy、health/ready 和 rollback/finalizer 证据是否完整。
9. `Release Decision`：确认 release policy 和 `GET /api/v1/release/decisions` 是否解释 `GO` / `CONDITIONAL-GO` / `NO-GO`。
10. `GA Release`：确认 promoted/succeeded release run、merge commit 和 GA evidence 是否可复盘。

如果链路图显示 `WAITING_APPROVAL`，先查看详情页的 Human Gate 说明、批准按钮、trace 和 release policy 证据；这通常是正常人工治理停点。如果链路图显示 `Source Closure`、`CI/CD + Deploy`、`Release Decision` 或 `GA Release` 还停在 `PLANNED`、`FAILED`、`HEALTH_FAILED`、`ROLLED_BACK`、`POLICY_BLOCKED` 或 `NO-GO`，不要只看 CI 成功。应先打开 Release Closure Runtime 或 Release Run Auto Repair Workbench，检查 `nextAction`、`policy.blockers`、required gates 和 artifacts，再决定是配置源码凭据、预检闭环、执行闭环、批准 Release、合并 Release、执行安全自动合并，还是进入修复队列。只有后四个节点和 `GET /api/v1/release/decisions` 都能解释 `GO` / `CONDITIONAL-GO` / `NO-GO`，这个 Source-to-GA 链路才算形成可审计结论。

生产模式下 `GET /api/v1/evaluation-datasets` 不依赖 sample/mock 开关。干净部署首次读取时，EvoPilot 会写入三条持久化生产基线评测集：`prod-baseline-source-to-ga`、`prod-baseline-tenant-rbac` 和 `prod-baseline-worker-human-gate`。这些基线用于让真实用户或自动化验收在没有历史样本的情况下仍能检查 Source-to-GA、多租户/RBAC、Worker/Human Gate 三条核心路径；后续接入项目和运行信号会继续追加真实评测集。

Release Run Auto Repair Workbench 用于处理已经失败或陈旧的源码发布记录。用户点击“刷新修复队列”时，Dashboard 会调用 `GET /api/v1/source-release-runs/repair-candidates`，列出需要恢复的 release run、失败阶段、failure signature、next action、capabilities 和推荐修复请求。用户可以点击某一行“修复”，也可以在确认候选范围后点击“一键修复队列”；Dashboard 会调用 `POST /api/v1/source-release-runs/repair-candidates/repair`，由 EvoPilot 重新进入 source closure 执行路径，继续完成 SCM 写回、deploy connector、health/ready、release policy 和 evidence 写入。修复成功后，新的 release run 会进入 `PROMOTED` 或其他非失败终态，原候选会从修复队列中移除。生产 ECS 演练已经验证该用户路径：本地 Git 项目因 dirty worktree 触发 `FAILED`，随后在 Dashboard 单行修复后生成 `PROMOTED` release run，并从 repair candidates 队列消失。

同一页面的 Target Loop Backlog 对应 `GET /api/v1/loop-orchestration/targets`、`POST /api/v1/loop-orchestration/advance` 和 `POST /api/v1/loop-orchestration/autopilot`。它把后续产品进化目标按 Sandbox、Context、Harness、Loop 四层排队，记录 acceptance criteria、next action、stop condition 和证据摘要；点击“推进下一 Target”时，EvoPilot 会创建或推进 Codex-backed target loop，而不是要求用户每次手工复制命令或重新描述上下文。点击“一键自动驾驶”时，EvoPilot 会在受控步数内推进 loop、停在 human gate 或 source closure 边界、执行源码闭环、跑 release policy、进行安全自动合并，并把 post-merge deploy 结果写回 release run；如果没有显式授权 human gate，自动驾驶会停在人工审批而不是绕过治理。

下一轮建议聚焦的 6 个 target 已内置进 Target Loop Backlog，并且已经有产品运行时 API 承接：`POST /api/v1/loop-target-runtime/discovery/run` 会把仓库、trace、评测、生产信号和人工信号沉淀成 discovery candidate；`POST /api/v1/loop-target-runtime/handoffs` 会给每个 finding 分配隔离 workspace、target branch、文件范围、验证命令和 rollback ref；`POST /api/v1/loop-target-runtime/adversarial-evaluations` 会在 merge/deploy 前独立挑战 diff、测试、发布证据和完成声明；`POST /api/v1/loop-target-runtime/schedules` 会按时间窗、证据阈值和预算创建 recurring loop schedule；`GET /api/v1/loop-target-runtime/memory-inbox` 与 triage API 会把历史发现、用户反馈、失败评测和发布经验整理成可转 target 的 inbox；`POST /api/v1/loop-target-runtime/guardrails/{loopId}/evaluate` 会把成本、token、时间、影响面、置信度和发布判断变成显式 stop condition。`GET /api/v1/loop-target-runtime/summary` 可用于 Dashboard 或自动化一次读取这 6 类运行时对象。

如果目标是把 EvoPilot 作为类似 SaaS 的云服务开放，Target Loop Backlog 还提供一组云服务化 target：`tenant-workspace-model`、`github-app-onboarding`、`secret-vault-and-credential-boundary`、`quota-rate-limit-billing-foundation`、`production-observability-domain-https`、`worker-queue-and-postgres-store` 和 `saas-onboarding-dashboard`。第一步应选择 `tenant-workspace-model`，因为它先定义租户、workspace、成员、角色、项目归属、凭据范围、loop evidence、release evidence 和单租户迁移边界。生产环境管理 EvoPilot 自身时，应使用已接入的远程仓库项目 `evopilot-github`，然后推进 `tenant-workspace-model`，让 EvoPilot 把自己的 SaaS 架构演进记录成真实 loop，而不是只在文档中模拟。

Loop 页面还提供面向真实用户操作的工作台。Context Time Travel Workbench 会列出当前 Loop 的 checkpoint，用户选择 iteration、输入 Context Patch JSON 后点击“Replay 并生成 Diff”，Dashboard 会调用 `POST /api/v1/loops/{loopId}/time-travel/replay`，把人工编辑、replay 轮次和 replay diff 写回 loop。Worker Queue Workbench 会显示 durable queue、worker lease、过期 lease、下一步动作和 source-closure 重复副作用保护；点击“Claim 下一 Loop”会调用 `POST /api/v1/loop-workers/claim` 写入 worker lease，供 worker 或 watchdog 后续恢复执行。Sandbox Boundary Workbench 可以验证 Docker/K8s sandbox proof，并把 runtime、network、credential、path、resource 检查写回 loop。Streaming Trace Workbench 可以读取 trace tree 和 streaming events，用于查看 checkpoint、executor step、per-node cost/tokens、failure group、replay diff 和 sandbox proof。

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

接入后，Dashboard 的“接入项目”会显示源码写回凭据状态，并可点击“配置凭据”或“验证写回凭据”。这个项目级预检会区分公开 GitHub 只读接入、`tokenRef` 未解析、分支不可读和源码写回 `READY`，对应 API 为 `POST /api/v1/projects/{projectId}/source-credentials/preflight`。用户可以在“配置凭据”里填写服务端环境变量名 `tokenRef`，也可以填写 inline token；EvoPilot 保存后立即执行 readiness 检查，达到 `READY` 后，目标 loop 才能继续 source closure。Dashboard 的 Loop Runtime 表格和详情工作台会显示 `sourceClosure.closureState`、required gates、branch、commit、PR/MR、tag、deployment、health/ready、rollback、typed graph、sandbox enforcement、checkpoint、replay diff 和 worker/watchdog 证据。管理员可以先点击“预检闭环”，或调用 `POST /api/v1/loops/{loopId}/source-closure/preflight`，由 EvoPilot 在不创建分支、不写文件的前提下检查项目绑定、GitHub/GitLab token 或 tokenRef、source branch、deploy target 和 health-ready 条件。若自动驾驶在这里发现缺少写回 token 或 `tokenRef` 未解析，Target Loop Backlog 会显示 `externalBlocker.type=source-credential`、`nextAction=configure-source-credentials` 和恢复动作“接入项目 -> 验证写回凭据”，用户应先补齐凭据，而不是继续强推 source closure。预检通过后再点击“执行闭环”，或调用 `POST /api/v1/loops/{loopId}/source-closure/execute`，由 EvoPilot 对 GitHub/GitLab 执行分支、提交、PR/MR、Tag、deploy connector 和 health/ready gate 探测；对本地目录项目则在注册的 `repository.root` 中创建或切换 release branch、写文件、提交并打 tag。每次执行都会生成 `sourceReleaseRun`，可通过 `GET /api/v1/source-release-runs`、`GET /api/v1/loops/{loopId}/source-release-runs` 或 Dashboard 的“刷新 Release Run”查看阶段、next action、capabilities、source ref、policy、postMergeDeployment 和 artifacts。随后可以点击“批准 Release”“合并 Release”或“安全自动合并”，也可以调用 `POST /api/v1/loops/{loopId}/source-closure/review-decision`。EvoPilot 会在 merge 前执行 release policy gate；若 required gates、review、commit、PR/MR artifact 或 health/deploy 证据不满足，会阻断并把 `policy.blockers` 写回 release run。策略通过后才会合并 PR/MR 或本地 release branch，并把审批人、审批时间、合并人、合并时间、merge commit、post-merge deploy 和 health/ready 结果写回同一条发布记录。

自动部署应先注册部署连接器：

```http
POST /api/v1/connectors/deploy
```

当前内置两类部署连接器：

- `http-webhook`：EvoPilot 会把 loop、源码、branch、commit、tag、PR/MR 和环境参数发送给部署系统，由部署系统返回 `deploymentId`、`deploymentUrl`、`healthUrl` 和 `readyUrl`。
- `ecs-docker-compose`：EvoPilot 在配置的服务器 `workingDir` 内执行受限发布序列，先读取当前 commit，可选保留 `preserveLocalPaths` 指定的生产本地补丁，再执行 `git pull --ff-only <remote> <branch>`、恢复本地补丁，并执行 `docker compose -f <composeFile> up -d --build [serviceName]`，把每条命令的退出码和截断输出写入 deploy gate 证据。自托管 EvoPilot 可以设置 `skipComposeWhenUnchanged=true`，当 pull 后 commit 未变化时跳过 compose，避免控制面在自己的 API 请求中重启自己，并由 health-ready gate 证明生产可用。该连接器默认启用 `deployLock`、`idempotency`、`rollbackOnFailure` 和 `rollbackOnHealthFailure`：同一 release key 不重复执行 compose，compose 失败或发布后 health/ready 探测失败时会回到发布前 commit 并重新启动 compose。

Dashboard 会在“接入项目”页展示部署连接器列表；执行闭环时，如果 loop 已绑定 `deploymentConnectorId` 或生产环境只有一个部署连接器，会自动携带该连接器。

### 项目级发布等级 Target

进入“项目”页后，项目详情工作区会展示 `Experimental`、`Alpha`、`Beta`、`Release Candidate`、`GA Release` 五个标准等级模板。模板本身是公共发布等级，不直接代表某个 GitHub 项目的结论；用户需要先把模板复制为项目专属 target，再生成该项目的 release decision。

推荐流程：

1. 在“项目”页注册 GitHub/GitLab/local Git 项目，并完成源码凭据预检。
2. 在项目详情的“项目发布目标”区域选择等级模板，例如 `Beta` 或 `GA Release`。
3. 点击“复制为项目目标”，EvoPilot 会创建 `scope=project`、带 `projectId` 和 `templateId` 的 release target。
4. 点击“生成判定”，EvoPilot 调用 `POST /api/v1/release/evidence`，只统计该项目的 pipeline、code upgrade、source release run、风险和场景证据。
5. 在同一区域查看项目级 `GO` / `CONDITIONAL-GO` / `NO-GO`，或通过 `GET /api/v1/release/decisions?targetId=<targetId>&projectId=<projectId>` 查询历史。

项目级 target 不能跨项目复用。如果 target 已绑定 `projectId=project-a`，但 evidence 请求传入 `projectId=project-b`，服务端会拒绝并返回 `RELEASE_TARGET_PROJECT_MISMATCH`。这样可以避免项目 B 借用项目 A 的 CI/CD、代码升级或发布证据。

## 10. 角色权限

EvoPilot Dashboard 采用“登录账号 + API 角色 + 租户/工作区作用域”的模型。普通用户不需要 API Token 登录；浏览器登录页只接受用户名和密码。EvoPilot 不是公网自助注册平台，账号开通链路是 `平台高级管理员 -> 租户管理员 -> 租户内用户`：平台高级管理员创建租户、工作区和租户管理员，租户管理员再创建本租户开发者、发布负责人、运维或 Viewer。

| 角色 | 入口 | 主流程 | 权限边界 |
|---|---|
| 未登录用户 | 登录页、帮助手册 | 使用管理员分配的用户名/密码登录，查看公开帮助，访问健康检查。 | 没有注册链接；不能读取租户、项目、Loop、凭据、发布证据或审计。 |
| 平台高级管理员 | 租户总览、用户与权限、工作区、凭据、发布证据、审计 | 首次使用 `admin/admin` 登录并强制改密；创建租户和工作区；创建租户管理员；停用/启用用户；重置密码；跨租户审计。 | 必须保留 release decision、workspace scope 和审计链路；不能用全局权限绕过发布门禁。 |
| 租户管理员 | 用户与权限、工作区、项目、凭据、Loops、发布证据 | 创建本租户用户；修改本租户用户角色和状态；重置本租户用户密码；接入项目；配置 workspace 凭据；授权 human gate。 | 不能创建租户，不能创建 `platformAdmin`，不能访问其他 tenant/workspace。 |
| Workspace 开发者 | 项目、工作区、Loops、发布证据 | 接入项目，复制 Experimental/Alpha/Beta/RC/GA 发布等级模板为项目 target，导入 evidence，启动 Source-to-GA Loop，查看代码升级过程，提交修复证据。 | 不能创建用户、修改角色、读取其他 workspace 凭据或跨租户操作。 |
| 发布负责人 | 发布证据、Loops、审计 | 审批 Release、修复失败 Release Run、执行 deploy finalizer、复盘 GO/NO-GO。 | 不能补充源码凭据或成员权限；证据不足时只能退回处理。 |
| Loop 运维 | Loops、发布证据、审计 | 处理 worker queue、watchdog、replay、sandbox proof 和 streaming trace 的运行恢复。 | 不能审批业务发布或修改租户成员；恢复动作必须产生 trace/audit。 |
| 审计 Viewer | 租户总览、工作区、发布证据、审计 | 只读查看 tenant/workspace、release decision、artifacts、audit 和历史证据。 | 不能创建、审批、修复、写入凭据或修改成员。 |

常用操作路径：

1. 平台高级管理员：登录页 -> 改密 -> 租户总览 -> 创建租户与工作区 -> 用户与权限 -> 创建租户管理员。
2. 租户管理员：使用平台高级管理员创建的账号登录 -> 用户与权限 -> 创建 developer/viewer -> 凭据 -> 配置 GitHub App 或 tokenRef -> 项目 -> 接入项目。
3. 开发者：项目 -> 验证源码凭据 -> 项目发布目标 -> 复制 Beta/RC/GA 模板 -> Loops -> 启动 Source-to-GA Loop -> 发布证据 -> 查看项目级结果。
4. 发布负责人：发布证据 -> 查看 release decision -> 修复失败发布或批准发布 -> 审计。
5. 审计 Viewer：发布证据 -> 审计 -> 按 tenant/workspace/requestId 复盘证据。

相关 API：

| 操作 | API |
|---|---|
| 登录 | `POST /api/v1/auth/login` |
| 修改密码 | `POST /api/v1/auth/change-password`，成功后使用响应中的新 token 继续访问 |
| 创建租户 | `POST /api/v1/tenants` |
| 创建工作区 | `POST /api/v1/workspaces`，后续使用返回的 `data.id` 查询 usage |
| 查看用户 | `GET /api/v1/users` |
| 创建用户 | `POST /api/v1/users` |
| 修改用户 | `PATCH /api/v1/users/{userId}` |
| 重置密码 | `POST /api/v1/users/{userId}/reset-password` |
| 历史复盘 | `GET /api/v1/history` |
