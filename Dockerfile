FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages ./packages
RUN npm ci

FROM deps AS build
COPY docs ./docs
COPY templates ./templates
COPY runtimes ./runtimes
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
RUN sed -i 's#https://dl-cdn.alpinelinux.org/alpine#https://mirrors.aliyun.com/alpine#g' /etc/apk/repositories \
  && apk add --no-cache git docker-cli docker-cli-compose
ENV NODE_ENV=production
ENV EVOPILOT_RUN_MODE=prod
ENV EVOPILOT_HOST=0.0.0.0
ENV EVOPILOT_PORT=19876
ENV EVOPILOT_DATA_ROOT=/var/lib/evopilot
ENV EVOPILOT_CODE_UPGRADER_BASE_URL=http://evopilot-code-upgrader:3000
ENV EVOPILOT_PRODUCT_JENKINS_BASE_URL=http://evopilot-jenkins:8080
ENV EVOPILOT_PRODUCT_JENKINS_JOB=evopilot-evolution-delivery
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/docs ./docs
COPY --from=build /app/templates ./templates
COPY --from=build /app/runtimes ./runtimes
COPY scripts ./scripts
EXPOSE 19876
CMD ["npm", "run", "server"]
