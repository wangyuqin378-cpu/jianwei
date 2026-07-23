ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS build

WORKDIR /workspace/backend
COPY backend/package.json backend/pnpm-lock.yaml backend/pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY backend/ ./
COPY knowledge /workspace/knowledge
COPY deploy/Dockerfile /workspace/deploy/Dockerfile
RUN pnpm release:identity -- --write release-identity.json && pnpm build && pnpm prune --prod

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=9000 \
    TZ=Asia/Shanghai

WORKDIR /app/backend
COPY --from=build --chown=node:node /workspace/backend/dist ./dist
COPY --from=build --chown=node:node /workspace/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/backend/release-identity.json ./release-identity.json
COPY --chown=node:node backend/package.json ./package.json
COPY --chown=node:node backend/migrations ./migrations
COPY --from=build --chown=node:node /workspace/knowledge /app/knowledge

USER node
EXPOSE 9000
CMD ["node", "dist/index.js"]
