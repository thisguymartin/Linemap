# Linemap: canvas server + frontend + MCP/CLI in one image, on Bun.
#
#   docker build -t linemap .
#   docker run -p 3000:3000 -v linemap-data:/data linemap
#
# The default command runs the canvas server (browser UI + REST + WebSocket).
# Agents (local claude / codex CLIs) are not available in the container: the
# server listens beyond localhost there, so it switches them off.

FROM oven/bun:1.4 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json vite.config.ts ./
COPY src ./src
COPY frontend ./frontend
COPY scripts ./scripts
COPY assets ./assets
RUN bun run build

FROM oven/bun:1.4-slim AS production
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY --from=builder /app/dist ./dist
COPY assets ./assets
COPY skills ./skills
RUN mkdir -p /data && chown -R bun:bun /app /data
USER bun
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    EXCALIDRAW_DATA_DIR=/data \
    EXPRESS_SERVER_URL=http://127.0.0.1:3000
VOLUME ["/data"]
EXPOSE 3000
CMD ["bun", "dist/server.js"]

LABEL org.opencontainers.image.description="Linemap: a local Excalidraw workbench you and your coding agents share"
LABEL org.opencontainers.image.licenses="MIT"
