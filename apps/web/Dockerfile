# Trace-X Web — built from the monorepo root (needs the shared package types).
# Build:  docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=... -t tracex-web .
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
COPY packages/shared ./packages/shared
COPY apps/web/package.json ./apps/web/
RUN cd apps/web && npm install --no-package-lock
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
ARG VITE_API_URL=/api/v1
ARG VITE_WS_URL=""
WORKDIR /app/apps/web
ENV VITE_API_URL=$VITE_API_URL VITE_WS_URL=$VITE_WS_URL
RUN npx vite build

FROM nginx:alpine
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
