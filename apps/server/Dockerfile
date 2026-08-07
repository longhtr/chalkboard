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
RUN pnpm --filter @chalkboard/server build

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS production-dependencies
RUN corepack enable
WORKDIR /workspace
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/shared/package.json apps/shared/package.json
RUN pnpm install --frozen-lockfile --prod --filter @chalkboard/server...

FROM node:25-alpine@sha256:bdf2cca6fe3dabd014ea60163eca3f0f7015fbd5c7ee1b0e9ccb4ced6eb02ef4 AS production
ARG APP_VERSION=0.1.0
ARG VCS_REF=development
LABEL org.opencontainers.image.title="Chalkboard server" \
  org.opencontainers.image.version="$APP_VERSION" \
  org.opencontainers.image.revision="$VCS_REF"
ENV CHALKBOARD_COMMIT=$VCS_REF \
  CHALKBOARD_VERSION=$APP_VERSION \
  NODE_ENV=production
WORKDIR /app/apps/server
COPY --from=production-dependencies /workspace/node_modules /app/node_modules
COPY --from=production-dependencies /workspace/apps/server/node_modules ./node_modules
COPY --from=build /workspace/apps/server/dist ./dist
COPY apps/server/migrations ./migrations
# The runtime starts compiled code directly and does not need npm's CLI dependency tree.
RUN rm -rf \
    /opt/yarn-v1.22.22 \
    /usr/local/lib/node_modules/corepack \
    /usr/local/lib/node_modules/npm \
  && rm -f \
    /usr/local/bin/corepack \
    /usr/local/bin/npm \
    /usr/local/bin/npx \
    /usr/local/bin/pnpm \
    /usr/local/bin/pnpx \
    /usr/local/bin/yarn \
    /usr/local/bin/yarnpkg
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
