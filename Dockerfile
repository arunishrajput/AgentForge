# AgentForge — single container for Cloud Run.
#
# Three stages so the runtime image carries no devDependencies and no source:
# Next's `standalone` output bundles only the server files it actually needs.
# Written in Phase 1 deliberately, so Phase 2 is a deploy and not a deploy plus a
# containerisation debugging session.

ARG NODE_IMAGE=node:26-alpine

# ---------- dependencies ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---------- build ----------
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No environment is needed to build: env validation runs at server startup
# (src/instrumentation.ts) and the database client is constructed lazily.
RUN npm run build

# ---------- runtime ----------
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

# Cloud Run injects PORT and expects the container to listen on it on all
# interfaces. 8080 is the default it uses; HOSTNAME must not be localhost.
ENV PORT=8080
ENV HOSTNAME=0.0.0.0
EXPOSE 8080

CMD ["node", "server.js"]
