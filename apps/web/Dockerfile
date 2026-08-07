# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS workspace
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/shared/package.json apps/shared/package.json
RUN pnpm install --frozen-lockfile

FROM workspace AS build
COPY . .
RUN pnpm --filter @chalkboard/web build

FROM nginxinc/nginx-unprivileged:1.31.3-alpine@sha256:59ccf0943b0b8e8d9e6ea9039a39555730f544701a655c596f7df7d096c593f5 AS production
ARG APP_VERSION=0.1.0
ARG VCS_REF=development
LABEL org.opencontainers.image.title="Chalkboard web" \
  org.opencontainers.image.version="$APP_VERSION" \
  org.opencontainers.image.revision="$VCS_REF"
USER 101
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
