# EvoPilot 用户操作手册

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

## 9. 角色权限

| 角色 | 能力 |
|---|---|
| `viewer` | 查看项目、运行、机会点、流水线、历史和审计。 |
| `operator` | 上报证据、编译规则、创建机会点、提交评审决策。 |
| `admin` | 注册项目、配置连接器、触发代码升级和交付。 |
