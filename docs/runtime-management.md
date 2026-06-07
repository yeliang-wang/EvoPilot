# EvoPilot 托管运行时管理

## 定位

EvoPilot 的生产产品形态不是把第三方组件塞进主进程。代码升级执行器属于 EvoPilot 的核心能力，随产品套件托管运行；Jenkins 属于企业 CI/CD 连接器，由系统管理员或项目管理员接入。

生产形态是：

```text
EvoPilot 产品套件
├── evopilot-server
├── evopilot-dashboard
└── evopilot-code-upgrader  基于真实 OpenHands 能力的托管代码升级运行时
```

代码升级运行时由 EvoPilot 的 `docker-compose.yml`、K8s YAML 或 Helm 包统一部署、统一配置、统一健康检查和统一治理。Jenkins 不随 EvoPilot 打包部署，不进入运行时锁；EvoPilot 通过外部 CI/CD 连接器调用真实 Jenkins。

## 运行时锁定

运行时锁定文件：

```text
runtimes/runtime-lock.json
```

该文件记录：

- 运行时 ID。
- 运行时职责。
- 实现项目。
- 版本。
- 镜像。
- 镜像 Digest。
- SBOM。
- 许可证报告。
- 漏洞扫描报告。
- 健康检查地址。

生产强校验：

```bash
npm run verify:runtime-lock:strict
```

该命令要求所有必需运行时都满足：

- 镜像 Digest 已锁定。
- 如果存在沙箱 runtime 镜像，沙箱镜像 Digest 也已锁定。
- SBOM 文件存在。
- 许可证报告存在。
- 漏洞扫描报告状态为 `PASSED`。
- 健康端点是明确的 HTTP/HTTPS 地址。

任何一项不满足，都不能声明产品生产级发布完成。

## Jenkins 连接器

Jenkins 不作为 EvoPilot 托管运行时，也不以 jar 依赖进入 EvoPilot 主进程。

EvoPilot 提供外部 Jenkins 连接器：

```text
packages/adapter-jenkins
/api/v1/connectors/jenkins
```

连接器支持两级配置：

- 系统默认 Jenkins：适合多数项目共用。
- 项目独立 Jenkins：在项目注册时覆盖系统默认连接器和 Job。

如果项目没有独立 Jenkins，EvoPilot 使用系统默认 Jenkins；如果两者都没有配置，代码升级完成后 CI/CD 会进入阻断状态，不会跳过或模拟成功。

## OpenHands 运行时

OpenHands 作为 EvoPilot 代码升级运行时，不以 jar 依赖进入 EvoPilot 主进程，但作为 EvoPilot 产品套件内的托管运行时部署。

EvoPilot 通过 `packages/adapter-openhands` 调用 OpenHands HTTP API，并传入：

- 进化方案 Markdown。
- Git 仓库信息。
- 源分支和升级分支。
- 提交信息。
- 验证命令。
- 受保护路径。

OpenHands 必须以真实进程运行，不能使用 fake、mock、stub、simulator 或内部模拟进程冒充。

## 部署入口

Docker Compose：

```bash
docker compose up -d
```

K8s：

```bash
kubectl apply -f deploy/k8s/
```

生产验证前必须确认：

```bash
npm run verify:runtime-lock:strict
```

如果本机没有 Docker、无法拉取镜像、无法生成 SBOM 或无法完成漏洞扫描，必须将状态报告为阻塞，不能降级为 mock E2E。
