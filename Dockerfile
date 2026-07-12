# syntax=docker/dockerfile:1

# ---- Stage 1: build the React frontend ----
FROM node:22-alpine AS web-build
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- Stage 2: compile the Express backend (TypeScript -> JS) ----
FROM node:22-alpine AS server-build
WORKDIR /server
COPY server/package*.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

# ---- Stage 3: lean runtime image ----
FROM node:22-alpine AS runtime
# ffmpeg is the heart of the streaming pipeline (used in later milestones)
RUN apk add --no-cache ffmpeg
ENV NODE_ENV=production
WORKDIR /app

# Production dependencies only
COPY server/package*.json ./
RUN npm ci --omit=dev

# Compiled backend + built frontend
COPY --from=server-build /server/dist ./dist
COPY --from=web-build /web/dist ./public

EXPOSE 8688
CMD ["node", "dist/index.js"]
