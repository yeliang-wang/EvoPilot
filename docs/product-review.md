# EvoPilot 产品评审

## 评审结论

当前结论：EvoPilot SaaS 多租户版本已在 2026-07-07 生产验收中达到生产级 GA stable Release 标准，可以进入对外公开发布阶段。此前的产品评审结论已经落地为独立产品控制面、SaaS 多租户 Dashboard、角色化帮助手册、Postgres business store、真实 GLM Loop Runtime、项目级 release decision 和生产观测证据。

EvoPilot 应该作为从 `domainforge-fabric-self-evolution` 演化出的独立产品化平台建设，而不是作为 `domainforge-fabric` 内部模块存在。

继承下来的核心链路是：

```text
EvidenceBundle
-> 机会点
-> 源码影响面
-> 演进计划
-> 评审
-> MR / CI
-> 学习
```

新平台必须补齐：

```text
项目接入
基线评估
治理
监控
交付
发布
回滚
版本与知识治理
```

## 产品边界

AI Agent 产品执行业务工作。EvoPilot 负责围绕这些产品运转产品演进与交付控制平面。

更准确地说，EvoPilot 的产品模型是持续演进控制面：Evidence Layer 负责真实信号，Decision Layer 负责机会和风险判断，Execution Layer 负责已批准动作的推进，Governance Layer 负责权限、审批、审计和停止条件，Continuity Layer 负责长任务跨轮推进。Loop Runtime 是其中的连续性和执行底座，不等于整个产品。

EvoPilot 可以：

- 采集并标准化证据。
- 发现演进机会。
- 按项目规则计算优先级。
- 基于模板生成计划。
- 要求评审和确认。
- 创建 PR/MR 草稿。
- 触发 CI 和交付工作流。
- 仅在策略门禁通过后执行发布。
- 跟踪发布后效果。
- 从已验证结果中学习。
- 通过 Loop Runtime 保持长任务状态、timeline、evidence sets、artifacts 和 worker lease。
- 用产品原生 release decision 判断 `GO` / `CONDITIONAL-GO` / `NO-GO`。

EvoPilot 不应该：

- 在没有项目画像许可时修改受保护资产。
- 在没有显式策略和用户确认时发布。
- 在缺少评审证据时把单次失败固化为永久规则。
- 把项目专属词汇放进通用核心。
- 把健康检查、单次 CI 成功或 executor 自报成功当成最终发布结论。
- 把自身描述成通用 agent framework；外部 agent runtime 可以是执行器，但不是 EvoPilot 的产品边界。

## 控制台覆盖面

控制台参考常见软件交付平台的信息架构：总览、项目、证据、机会点、计划、评审、流水线、发布、验证、可观测性、功能开关、策略、模板、画像、洞察、审计和设置。

它面向 AI Agent 产品，而不是通用软件服务。
