# syntax=docker/dockerfile:1

# Build context is the repository root so the shared workspace package is
# available. Build with:
#   docker build -f roomfrontend/Dockerfile -t ephemeral-rooms-frontend .

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
COPY . .

# NEXT_PUBLIC_* values are inlined into the client bundle, so the WebSocket URL
# is a build argument: rebuild the image when it changes.
ARG NEXT_PUBLIC_WS_URL=ws://localhost/ws
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build:frontend

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app

# With outputFileTracingRoot set to the repository root, the standalone folder
# mirrors that root and contains roomfrontend/server.js.
COPY --from=build --chown=node:node /app/roomfrontend/public ./roomfrontend/public
COPY --from=build --chown=node:node /app/roomfrontend/.next/standalone ./
COPY --from=build --chown=node:node /app/roomfrontend/.next/static ./roomfrontend/.next/static

USER node
EXPOSE 3000

CMD ["node", "roomfrontend/server.js"]
