# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build: install the workspace, build web + server, then produce a pruned
# production install of the server (pnpm deploy) for the runtime stage.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
# better-sqlite3 v13 has no prebuilt binaries; node-gyp compiles it from
# source and needs a toolchain (build stage only — the compiled binding is
# carried into the runtime stage via pnpm deploy).
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages ./packages
RUN pnpm --recursive build
RUN pnpm --filter @courseo/server --prod deploy /out/server

# ---------------------------------------------------------------------------
# Runtime: one image, one port — API + built web UI, no proxy required.
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    LIBRARIES_ROOT=/libraries \
    WEB_DIST=/app/web

WORKDIR /app
COPY --from=build /out/server ./server
COPY --from=build /app/packages/web/dist ./web

# /data holds the SQLite DB; /libraries is the parent mount with one
# subfolder per library, mounted read-write for in-UI move/rename.
RUN mkdir -p /data /libraries && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

# Node one-liner, not curl — the image must be able to run its own
# healthcheck or orchestrators mark it unhealthy (spec §6.1).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
