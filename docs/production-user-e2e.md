# 真实生产用户 E2E 场景

## 当前验收结论

2026-07-07 生产环境真人/数字用户联合验收显示：EvoPilot SaaS 多租户版本已达到生产级 GA stable Release 标准。验收覆盖 Track A 功能场景和 Track B 端到端链路，共 92 项，88 PASS，0 FAIL，4 WARN，综合通过率 95.7%。

本结论成立的关键条件：

- 未登录业务 API 返回 401，Viewer 写操作返回 403，RBAC 边界有效。
- 平台高级管理员、租户管理员、开发者和 Viewer 的核心路径可用。
- 真实 GitHub 项目完成项目接入、Alpha/Beta/RC/GA release target、release evidence、trace/events/executor graph。
- Loop Runtime 使用真实 GLM-5.1，经 `meta.llm`、Loop trace 和 `totalTokens` 验证，不是 smoke/mock。
- `WAITING_APPROVAL` 是 Human Gate 合法终态，需要人工审批，不按失败处理。

验收报告工具中的派生统计不能替代生产 API：LLM token 总量以生产 `meta.llm` 和 Loop trace 为准，截图数量以实际产物目录为准。

## 场景目标

生产用户已经接入一个真实 AI Agent 项目。线上 Trace / Tool Call / RAG / Cost 证据显示订单助手链路 p95 超过 3 秒，用户希望 EvoPilot 自动形成演进机会点，生成可编辑方案，在用户确认后完成代码升级，并进入真实 CI/CD。

## 用户路径

1. 用户在“接入项目”注册真实 Git 项目。
2. 用户在“证据策略”输入自然语言规则：`所有链路调用小于 3 秒`。
3. EvoPilot 使用真实 GLM 将规则编译为系统执行规则，并写入 Markdown。
4. 接入项目上报真实运行证据，触发机会点。
5. 用户在“评测集”选择多个评测集，形成一个机会点。
6. EvoPilot 使用真实 GLM 生成 Markdown 进化方案。
7. 用户查看并编辑方案，确认进化。
8. EvoPilot 调用真实代码升级执行器，根据方案修改代码。
9. 代码升级成功后，EvoPilot 通过项目 DevOps 触发 GitHub Actions 或 GitLab CI。
10. CI/CD 成功后，EvoPilot 写入历史记录和审计证据。

## 真实生产链路验收命令

```bash
npm run test:e2e:production
```

该命令不启动模拟执行链路。生产产品级 E2E 要求代码升级执行器作为 EvoPilot 托管运行时提前启动并通过健康检查；项目必须配置真实可达的 GitHub Actions 或 GitLab CI DevOps。必需组件不可达时会直接失败。

该命令按 `EVOPILOT_RUN_MODE=prod` 创建服务；生产默认不开放样例兜底、匿名 admin 或模拟集成链路。

## 配置文件

```text
data/evopilot/production-e2e.env
```

必填配置：

```text
EVOPILOT_REAL_PROJECT_ID=
EVOPILOT_REAL_PROJECT_NAME=
EVOPILOT_REAL_PROJECT_PROVIDER=local-git|gitlab|github
```

EvoPilot 托管代码升级运行时默认服务发现配置：

```text
EVOPILOT_CODE_UPGRADER_BASE_URL=http://127.0.0.1:3000
```

项目 DevOps 配置：

```text
EVOPILOT_REAL_PROJECT_DEVOPS_PROVIDER=github-actions|gitlab-ci
EVOPILOT_REAL_PROJECT_CI_WORKFLOW=ci.yml
EVOPILOT_REAL_PROJECT_CI_REQUIRED_CHECKS=build,test
EVOPILOT_REAL_PROJECT_CI_REQUIRED_STAGES=test
EVOPILOT_REAL_PROJECT_CI_REQUIRED_JOBS=build
EVOPILOT_REAL_PROJECT_CD_WORKFLOW=deploy-prod.yml
EVOPILOT_REAL_PROJECT_DEPLOY_ENVIRONMENT=production
EVOPILOT_REAL_PROJECT_HEALTH_URL=https://my-agent.example.com/health
EVOPILOT_REAL_PROJECT_READY_URL=https://my-agent.example.com/ready
```

这些不是普通用户接入参数。代码升级运行时由系统管理员按 EvoPilot 产品套件服务发现地址覆盖；GitHub/GitLab token 由 EvoPilot 服务端 `tokenRef` 或 secret manager 解析。不能把 fake、mock、stub、simulator 或内部模拟进程作为产品生产级 E2E 的替代。

项目注册配置与 Dashboard 一致：

```text
# local-git
EVOPILOT_REAL_PROJECT_ROOT=/path/to/repo

# gitlab
EVOPILOT_REAL_PROJECT_GIT_URL=https://gitlab.example.com/group/project.git
# 或 EVOPILOT_REAL_PROJECT_BASE_URL + EVOPILOT_REAL_PROJECT_REMOTE_ID

# github
EVOPILOT_REAL_PROJECT_GIT_URL=https://github.com/owner/repo.git
# 或 EVOPILOT_REAL_PROJECT_OWNER + EVOPILOT_REAL_PROJECT_REPO
```

远程 Git 凭据至少配置一个：

```text
EVOPILOT_REAL_PROJECT_TOKEN=
EVOPILOT_REAL_PROJECT_PASSWORD=
EVOPILOT_REAL_PROJECT_TOKEN_REF=
```

其他配置：

```text
EVOPILOT_CODE_UPGRADER_API_KEY=
EVOPILOT_CODE_UPGRADER_WORKSPACE_MODE=docker
EVOPILOT_CODE_UPGRADER_MODEL=glm-5.1
EVOPILOT_REAL_VALIDATION_COMMANDS=npm run check
```

项目级 DevOps 配置建议通过 Dashboard 或 CLI `project devops set` 填写；生产 E2E 也可以通过项目注册请求携带 `devops.provider=github-actions|gitlab-ci`、`devops.ci` 和 `devops.cd`。

## 代码升级与 CI/CD 验收点

- 代码升级执行器必须调用真实 LLM 生成结构化升级计划。
- Loop Runtime 的 `llm` executor 必须调用真实 LLM Gateway 生成本轮计划，并在 loop trace 中保留 `provider`、`model`、`totalTokens`、`costUsd`；生产模式下缺少 LLM provider 时服务必须拒绝启动，不能把 `llm` 节点标记为空跑成功。
- 代码升级执行器必须接收当前 Git 基线代码上下文；修改已有文件时必须基于当前文件内容完整改写，不能只根据方案猜测代码。
- 代码升级执行器必须产生至少一个真实项目实现、测试、脚本或配置文件变更；仅写入 `.evopilot/upgrades/`、`.evopilot/runtime-upgrades/` 或 `docs/evopilot-upgrades/` 不能视为生产代码升级。
- EvoPilot 会根据项目当前 Git 基线推导代码升级允许路径，并把允许路径和受保护路径一起传给代码升级执行器。
- 代码升级执行器必须创建升级分支、提交变更、执行本地验证；只有验证通过后才能推送远端分支并返回 MR/PR 地址。
- 如果本地验证失败，代码升级执行器必须基于失败日志和当前生成文件发起真实 LLM 最小修复回合，修复后重新验证；仍失败才终止，不能依赖人工或 Codex 临时修复。
- 代码升级执行器必须拒绝修改受保护路径。
- 生成进化方案前必须读取项目当前 Git 基线代码，方案必须包含代码事实和目标可行性判断。
- GitHub Actions/GitLab CI 必须收到 `SOURCE_BRANCH`、`UPGRADE_BRANCH`、`COMMIT_SHA`、`MERGE_REQUEST_URL` 等 DevOps 参数。
- 只有代码升级成功后才能触发 CI/CD；代码升级失败时流程停止。
- CI/CD 完成后才生成发布报告、历史记录和审计证据。

## 当前真实状态

- 真实 Git 项目和真实 LLM 需要由生产环境配置提供。
- 代码升级执行器必须由 EvoPilot 产品套件部署为真实进程。
- 项目 DevOps 必须绑定真实 GitHub Actions 或 GitLab CI；EvoPilot 不托管项目 CI/CD，也不提供其他 CI/CD 连接器。
- 当前环境如果没有 Docker、无法拉取镜像、无法生成 SBOM 或无法完成漏洞扫描，应返回 `BLOCKED` 或失败，不允许自动降级。
