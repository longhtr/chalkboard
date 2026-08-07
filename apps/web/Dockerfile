# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e

FROM node:24-alpine@sha256:f70403e87646dc51b45295f4b8b70cdad0b63d2297c4c9899119b03f7af7a6b3 AS workspace
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

FROM nginxinc/nginx-unprivileged:1.31.3-alpine@sha256:a6c3ec0c0d249d68b0682df854d4a9e222b90fb607dc3fcf2f1d2fcbc85d347e AS production
ARG APP_VERSION=0.1.0
ARG VCS_REF=development
LABEL org.opencontainers.image.title="Chalkboard web" \
  org.opencontainers.image.version="$APP_VERSION" \
  org.opencontainers.image.revision="$VCS_REF"
USER 101
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
