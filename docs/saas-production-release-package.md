# SaaS 生产发布包

本文档用于把 EvoPilot SaaS 多租户控制面部署到生产环境，并把文件态业务数据迁移到 Postgres business store。Dashboard 可以展示发布状态和证据，但最终发布结论仍以 `GET /api/v1/release/decisions` 为准。

## 1. 启动生产依赖

```bash
docker compose up -d --build evopilot-postgres evopilot-code-upgrader evopilot-server evopilot-loop-worker
```

生产环境必须配置：

```text
EVOPILOT_RUN_MODE=prod
EVOPILOT_LOOP_STORE_BACKEND=postgres
EVOPILOT_LOOP_STORE_DSN=postgres://evopilot:<password>@evopilot-postgres:5432/evopilot
EVOPILOT_TOKENS=admin:<admin-token>:admin,operator:<operator-token>:operator,viewer:<viewer-token>:viewer
EVOPILOT_CODE_UPGRADER_BASE_URL=http://evopilot-code-upgrader:3000
```

`evopilot-code-upgrader` 必须和 server/worker 挂载同一个 `EVOPILOT_DATA_ROOT`，并能读取 `llm.env`。生产模式下不能只启动 server/worker；否则用户创建的 loop 只能进入队列，无法形成真实 GLM -> code-upgrade -> release closure 证据链。

## 2. 发布前检查

```bash
curl -fsS http://127.0.0.1:19876/health
curl -fsS http://127.0.0.1:19876/ready
curl -fsS -H "Authorization: Bearer <admin-token>" \
  http://127.0.0.1:19876/api/v1/loop-store/readiness
```

`/api/v1/loop-store/readiness` 必须返回：

- `status=READY`
- `backend=postgres`
- `postgresConfigured=true`
- `postgresReachable=true`
- `blockers=[]`

## 3. 文件数据迁移到 Postgres

先执行 dry-run，确认会迁移的集合和数量：

```bash
npm run store:postgres:migrate -- --data-root data/evopilot --dry-run
```

确认后写入 Postgres：

```bash
EVOPILOT_LOOP_STORE_DSN=postgres://evopilot:<password>@127.0.0.1:5432/evopilot \
npm run store:postgres:migrate -- --data-root data/evopilot
```

迁移会写入 `evopilot_business_records`，以 `collection + tenant_id + workspace_id + record_id` 作为幂等主键，覆盖 tenants、workspaces、projects、loops、executor graphs、release evidence、release targets、release decisions、source release runs、target loops、audit events 和 idempotency records。

## 4. 备份与恢复

备份 Postgres business store：

```bash
EVOPILOT_LOOP_STORE_DSN=postgres://evopilot:<password>@127.0.0.1:5432/evopilot \
npm run store:postgres:backup -- --out backups/evopilot-postgres-business-$(date +%Y%m%d%H%M%S).jsonl
```

恢复前先 dry-run：

```bash
npm run store:postgres:restore -- --in backups/evopilot-postgres-business.jsonl --dry-run
```

执行恢复：

```bash
EVOPILOT_LOOP_STORE_DSN=postgres://evopilot:<password>@127.0.0.1:5432/evopilot \
npm run store:postgres:restore -- --in backups/evopilot-postgres-business.jsonl
```

## 5. 发布判定

生产发布判定必须读取真实 API：

```bash
curl -fsS -H "Authorization: Bearer <admin-token>" \
  http://127.0.0.1:19876/api/v1/release/decisions
```

只有目标 release decision 返回 `GO`、所有 required criteria 通过、开放高风险为 0，并且 Postgres readiness 为 `READY` 时，才允许对外发布 SaaS 多租户版本。
