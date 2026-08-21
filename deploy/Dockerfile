ARG NODE_IMAGE
FROM ${NODE_IMAGE} AS prod-deps

WORKDIR /workspace/backend
COPY backend/package.json backend/pnpm-lock.yaml backend/pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --prod --no-optional --frozen-lockfile

FROM ${NODE_IMAGE} AS build

WORKDIR /workspace/backend
COPY backend/package.json backend/pnpm-lock.yaml backend/pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY backend/ ./
COPY knowledge /workspace/knowledge
COPY deploy/Dockerfile /workspace/deploy/Dockerfile
RUN pnpm release:identity -- --write release-identity.json && pnpm build

FROM ${NODE_IMAGE} AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=9000 \
    TZ=Asia/Shanghai

# The service starts with node directly. Remove build/package-manager tooling
# from the runtime image so npm/corepack advisories are not shipped needlessly.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/pnpm /usr/local/bin/pnpx

WORKDIR /app/backend
COPY --from=build --chown=node:node /workspace/backend/dist ./dist
COPY --from=prod-deps --chown=node:node /workspace/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/backend/release-identity.json ./release-identity.json
COPY --chown=node:node backend/package.json ./package.json
COPY --chown=node:node backend/migrations ./migrations
COPY --from=build --chown=node:node /workspace/knowledge /app/knowledge

USER node
EXPOSE 9000
CMD ["node", "dist/index.js"]
