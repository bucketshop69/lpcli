# syntax=docker/dockerfile:1

FROM node:23-slim AS base

# System deps for native modules (better-sqlite3, etc.)
RUN apt-get update && apt-get install -y \
  python3 \
  make \
  g++ \
  git \
  && rm -rf /var/lib/apt/lists/*

# Disable telemetry
ENV ELIZAOS_TELEMETRY_DISABLED=true
ENV DO_NOT_TRACK=1

WORKDIR /app

# Install pnpm + elizaos CLI
RUN npm install -g pnpm

# Copy monorepo root
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./

# Copy core and eliza packages
COPY packages/core/ packages/core/
COPY packages/eliza/ packages/eliza/

# Install deps and build
RUN pnpm install --ignore-scripts
RUN pnpm --filter @lpcli/core build
RUN pnpm --filter @lpcli/eliza build

# Create data directory for SQLite
RUN mkdir -p /app/data

EXPOSE 3000

ENV NODE_ENV=production
ENV SERVER_PORT=3000

CMD ["pnpm", "--filter", "@lpcli/eliza", "start"]
