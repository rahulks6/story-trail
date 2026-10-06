# Reproducible build. Two images from one Dockerfile, built from backend/ with the sibling admin/
# console sources passed as the named build context "admin":
#   docker buildx build --build-context admin=../admin -t katkee-api .                   (the API)
#   docker buildx build --build-context admin=../admin -t katkee-worker --target worker . (media worker: adds ffmpeg)
# Media lives in S3 in production (MEDIA_STORE=s3); nothing is written to the container.
FROM node:22-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.prod.json ./
COPY src ./src
COPY scripts ./scripts
# Application code and operational scripts only: no tests, no test-database tooling.
RUN npm run build:prod
# The Admin web console, built once: minified, content-hashed, integrity-checked and precompressed
# (scripts/build-admin.ts). Served from dist/admin, which production requires.
COPY --from=admin . /src/admin
RUN node dist/scripts/build-admin.js /src/admin dist/admin

FROM node:22-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV MEDIA_STORAGE_ROOT=/app/data/media
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY migrations ./migrations
RUN mkdir -p /app/data/media && chown -R node:node /app

# Media worker: processes uploads (sharp for photos, ffmpeg for video) and runs retention.
FROM base AS worker
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
USER node
ENV WORKER_HEARTBEAT_FILE=/tmp/katkee-worker-heartbeat
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
    CMD node -e "const s=require('fs').statSync(process.env.WORKER_HEARTBEAT_FILE);process.exit(Date.now()-s.mtimeMs<120000?0:1)"
CMD ["node", "dist/src/worker.js"]

# The API (last stage, so it stays the default build target).
FROM base AS runtime
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/index.js"]
