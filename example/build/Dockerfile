# Build from the app root: docker build -f build/Dockerfile -t app .
# Needs package-lock.json (created by the first npm install).

# 1. All dependencies, cached until package.json or the lockfile changes.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# 2. The Vite build: dist/ holds the server, RSC, SSR, and browser output.
FROM deps AS build
COPY . .
RUN npm run build

# 3. Production dependencies only.
FROM node:24-alpine AS runtime-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 4. The image: no sources, no dev dependencies.
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json .env ./
RUN mkdir -p storage/db storage/tmp && chown -R node:node storage
USER node
# Mount storage/ to keep the database across containers.
VOLUME /app/storage
EXPOSE 3000
CMD ["node", "dist/index.js"]
