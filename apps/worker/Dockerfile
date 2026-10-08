# Build from the repository root: docker build -f apps/worker/Dockerfile .
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
