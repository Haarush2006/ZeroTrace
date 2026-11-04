# syntax=docker/dockerfile:1

# Build context is the repository root so the shared workspace package is
# available. Build with:
#   docker build -f RoomsBackend/Dockerfile -t ephemeral-rooms-backend .

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY scripts ./scripts
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY RoomsBackend/package.json ./RoomsBackend/package.json
COPY roomfrontend/package.json ./roomfrontend/package.json
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages/protocol ./packages/protocol
COPY RoomsBackend ./RoomsBackend
RUN npm run build:backend \
 && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/protocol/package.json ./packages/protocol/package.json
COPY --from=build /app/packages/protocol/dist ./packages/protocol/dist
COPY --from=build /app/RoomsBackend/package.json ./RoomsBackend/package.json
COPY --from=build /app/RoomsBackend/dist ./RoomsBackend/dist
WORKDIR /app/RoomsBackend

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "--env-file-if-exists=.env", "dist/index.js"]
