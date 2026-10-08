# Worker image (apps/worker). Railway builds this root Dockerfile automatically.
# Local build: docker build -t orbit-worker .
FROM node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @orbit/worker...
RUN pnpm --filter @orbit/worker build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/apps/worker/dist ./dist
EXPOSE 8080
CMD ["node", "dist/index.js"]
