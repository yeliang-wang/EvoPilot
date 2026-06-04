# 真实生产用户 E2E 场景

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
9. 代码升级成功后，EvoPilot 触发产品托管 CI/CD。
10. CI/CD 成功后，EvoPilot 写入历史记录和审计证据。

## 真实生产链路验收命令

```bash
npm run test:e2e:production
```

该命令不启动模拟执行链路。默认会启动 EvoPilot 内部代码升级执行器和产品托管 CI/CD；如果系统管理员显式设置 `EVOPILOT_START_INTERNAL_RUNTIMES=false`，则必需组件不可达时会直接失败。

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

EvoPilot 内部运行组件默认配置：

```text
EVOPILOT_CODE_UPGRADER_BASE_URL=http://127.0.0.1:3000
EVOPILOT_PRODUCT_JENKINS_BASE_URL=http://127.0.0.1:8080
EVOPILOT_PRODUCT_JENKINS_JOB=evopilot-evolution-delivery
```

这些不是普通用户接入参数。单机生产验证使用默认值；容器或 K8s 部署由系统管理员按服务发现地址覆盖。

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
EVOPILOT_PRODUCT_JENKINS_USERNAME=
EVOPILOT_PRODUCT_JENKINS_API_TOKEN=
EVOPILOT_REAL_VALIDATION_COMMANDS=npm run check
```

## 代码升级与 CI/CD 验收点

- 代码升级执行器必须调用真实 LLM 生成结构化升级计划。
- 代码升级执行器必须产生至少一个非 `.evopilot/upgrades/` 的实现文件。
- 代码升级执行器必须创建升级分支、提交变更、推送远端分支，并返回 MR/PR 地址。
- 代码升级执行器必须拒绝修改受保护路径。
- 产品托管 CI/CD 必须收到 `SOURCE_BRANCH`、`UPGRADE_BRANCH`、`COMMIT_SHA`、`MERGE_REQUEST_URL`。
- 只有代码升级成功后才能触发 CI/CD；代码升级失败时流程停止。
- CI/CD 完成后才生成发布报告、历史记录和审计证据。

## 当前真实状态

- 真实 GLM：已配置并通过 `npm run test:e2e:real-llm`。
- 真实 Git 项目：`domainforge-fabric` 已通过 GitLab 注册验证。
- 代码升级执行器：已通过真实生产 E2E，能够 clone、创建升级分支、写入升级实现文件、提交并推送远端分支。
- EvoPilot 产品托管 CI/CD：已通过真实生产 E2E，能够接收升级分支、提交 SHA 与 MR/PR 地址，并生成发布报告。
- 真实生产 E2E 当前期望结果是 `PASSED`；如果外部凭据、网络或必需组件不可达，则应返回 `BLOCKED` 或失败，不允许自动降级。
