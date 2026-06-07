FROM ghcr.io/all-hands-ai/openhands:0.59 AS openhands-runtime

FROM node:22-alpine

RUN apk add --no-cache ca-certificates git openssh-client python3

WORKDIR /app
ENV EVOPILOT_RUN_MODE=prod
ENV EVOPILOT_CODE_UPGRADER_PORT=3000
ENV EVOPILOT_CODE_UPGRADER_DATA_ROOT=/var/lib/evopilot-code-upgrader

COPY package.json package-lock.json ./
COPY packages ./packages
COPY scripts ./scripts
RUN npm ci && npm run build --workspaces --if-present && npm prune --omit=dev
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production

COPY --from=openhands-runtime /app/LICENSE /opt/evopilot/vendor/openhands/LICENSE
COPY --from=openhands-runtime /app/README.md /opt/evopilot/vendor/openhands/README.md

# OpenHands 是 EvoPilot 代码升级运行时的锁定上游实现资产。
# 最终生产镜像只保留上游许可证和说明，避免把未执行的上游依赖树带入可运行镜像。

EXPOSE 3000
CMD ["node", "scripts/internal-code-upgrader.mjs"]
