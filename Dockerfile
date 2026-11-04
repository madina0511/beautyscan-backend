# syntax=docker/dockerfile:1
FROM node:24.22.2-bookworm-slim AS base
WORKDIR /app
RUN npm install --global npm@11.19.1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY nest-cli.json tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM node:24.22.2-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
RUN mkdir -p uploads && chown node:node uploads && chmod 700 uploads
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
