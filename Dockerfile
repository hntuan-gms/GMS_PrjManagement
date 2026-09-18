# Multi-stage build: client (Vite/React) + server (Express/TypeScript) into
# one small runtime image that serves both the UI and the API on one port.

FROM node:20-alpine AS client-build
WORKDIR /app/client
# .npmrc must land before `npm ci`: it carries legacy-peer-deps=true, without which
# gantt-task-react's react@^18 peer range fails against React 19.
COPY client/package.json client/package-lock.json client/.npmrc ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:20-alpine AS server-build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/ ./
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=server-build /app/server/dist ./dist
COPY --from=client-build /app/client/dist ./public

EXPOSE 4000
CMD ["node", "dist/index.js"]
