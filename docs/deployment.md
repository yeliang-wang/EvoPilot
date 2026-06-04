# 部署

## 本地生产近似运行

```bash
EVOPILOT_PORT=19876 \
EVOPILOT_RUN_MODE=prod \
EVOPILOT_DATA_ROOT=data/evopilot \
EVOPILOT_TOKENS=admin:change-me-admin-token:admin,operator:change-me-operator-token:operator,viewer:change-me-viewer-token:viewer \
npm run server
```

打开：

```text
http://127.0.0.1:19876/
```

## Docker

```bash
docker build -t evopilot:0.1.0 .
docker run --rm \
  -p 19876:19876 \
  -e EVOPILOT_TOKENS='admin:change-me-admin-token:admin,operator:change-me-operator-token:operator,viewer:change-me-viewer-token:viewer' \
  -v evopilot-data:/var/lib/evopilot \
  evopilot:0.1.0
```

## Docker Compose

```bash
docker compose up --build
```

## 运行模式

EvoPilot 默认按生产模式启动：

```text
EVOPILOT_RUN_MODE=prod
```

生产模式要求：

- 必须配置 `EVOPILOT_TOKENS` 或 `EVOPILOT_API_TOKEN`。
- `EVOPILOT_REQUIRE_LLM` 默认等于 `true`，LLM 未配置或失败时直接阻断。
- 不允许无鉴权 admin。
- 不允许模拟集成链路。
- 不自动注册内置项目画像。
- 不开放样例评测集。

本地调试必须显式打开：

```bash
npm run server:debug
```

调试模式下才允许样例数据、模板兜底和本地模拟集成链路，便于单元测试、冒烟测试和 Dashboard 原型验证。

## RBAC

角色：

| 角色 | 能力 |
|---|---|
| `viewer` | 读取汇总、项目、运行、画像和审计。 |
| `operator` | 拥有 viewer 能力，并可创建演进运行、提交评审决策。 |
| `admin` | 拥有 operator 能力，并可注册项目、执行交付。 |

## 幂等性

生产客户端应为 `POST /api/v1/runs` 设置 `X-Idempotency-Key`。

使用相同 key 重复请求时，服务端会返回第一次的响应，不会创建重复运行。
