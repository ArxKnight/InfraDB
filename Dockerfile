# Multi-stage build for InfraDB
FROM node:22-slim AS base
RUN npm install -g npm@11.11.0

# Install dependencies only when needed
FROM base AS deps
# Native build prerequisites for node-gyp
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
ENV PYTHON=/usr/bin/python3
WORKDIR /app

# Copy package files
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

# Install dependencies
RUN cd backend && npm ci
RUN cd frontend && npm ci

# Build frontend
FROM base AS frontend-builder
WORKDIR /app
COPY frontend/ ./frontend/
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
RUN cd frontend && npm run build

# Build backend
FROM base AS backend-builder
WORKDIR /app
COPY backend/ ./backend/
COPY --from=deps /app/backend/node_modules ./backend/node_modules
RUN cd backend && npm run build

# Production image
FROM node:22-slim AS runner
WORKDIR /app

# Install gosu for proper user switching (Debian equivalent of su-exec)
RUN apt-get update && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*

# Create app user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 infradb

# Install production dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY --from=frontend-builder /app/frontend/public ./frontend/public

# Copy startup script and create entrypoint
COPY docker/start.sh /app/start.sh
COPY docker/entrypoint.sh /app/entrypoint.sh
# Ensure scripts are executable and have Unix line endings (avoids "/bin/sh\r: not found" / "no such file" on Windows checkouts)
RUN sed -i 's/\r$//' /app/start.sh /app/entrypoint.sh \
    && chmod +x /app/start.sh /app/entrypoint.sh

# Create data directory for database and uploads with proper permissions
# Must be done as root before switching users
RUN mkdir -p /app/data && \
    chown -R infradb:nodejs /app/data && \
    chmod -R 777 /app/data
RUN mkdir -p /app/uploads && \
    chown -R infradb:nodejs /app/uploads && \
    chmod -R 777 /app/uploads
RUN touch /app/.env && \
    chown infradb:nodejs /app/.env && \
    chmod 666 /app/.env

# Note: We don't switch to infradb user here anymore
# The entrypoint will handle permissions and then run as infradb

# Expose port (configurable via environment)
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 3000) + '/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Use entrypoint to fix permissions, then start app
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["/app/start.sh"]