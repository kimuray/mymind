# syntax=docker/dockerfile:1
# mymind の開発環境（ADR-0010）。本番の常駐はホストの macOS で行い、このイメージは開発とテスト専用。

ARG NODE_VERSION=24

# ---------- 共通の土台 ----------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ARG PNPM_VERSION=10.34.5
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git tini \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g "pnpm@${PNPM_VERSION}" \
  && mkdir -p /workspace/node_modules /pnpm/store \
  && chown -R node:node /workspace /pnpm
ENV PNPM_HOME=/pnpm \
    npm_config_store_dir=/pnpm/store \
    MYMIND_IN_CONTAINER=1 \
    TZ=Asia/Tokyo
WORKDIR /workspace
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]

# ---------- 開発用（ソースはバインドマウント、node_modules はボリューム） ----------
FROM base AS dev
CMD ["sh", "-c", "pnpm install --frozen-lockfile && pnpm dev"]

# ---------- E2E 用（Chromium と依存ライブラリを追加） ----------
FROM base AS e2e
USER root
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY pnpm-lock.yaml /tmp/pnpm-lock.yaml
# lockfile に書かれた @playwright/test と同じバージョンのブラウザを入れる（バージョンのずれを防ぐ）
RUN set -eu; \
  version="$(sed -n "s/^  '@playwright\/test@\([0-9][0-9.]*\)':.*/\1/p" /tmp/pnpm-lock.yaml | head -n 1)"; \
  test -n "$version" || { echo "pnpm-lock.yaml から @playwright/test のバージョンを読めませんでした" >&2; exit 1; }; \
  npx -y "playwright@${version}" install --with-deps chromium; \
  chown -R node:node /ms-playwright; \
  rm -rf /tmp/pnpm-lock.yaml /root/.npm /var/lib/apt/lists/*
USER node
CMD ["sh", "-c", "pnpm install --frozen-lockfile && pnpm test:e2e"]
