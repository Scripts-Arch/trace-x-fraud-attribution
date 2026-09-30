# Trace-X API — built from the monorepo root so it can see the shared package.
# Build:  docker build -f apps/api/Dockerfile -t tracex-api .
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/api/package.json ./apps/api/
RUN cd apps/api && npm install --no-package-lock
COPY packages/shared ./packages/shared
COPY apps/api/src ./apps/api/src
COPY apps/api/seeds ./apps/api/seeds
WORKDIR /app/apps/api
RUN npx tsc -p tsconfig.json && npx tsc -p ../../packages/shared/tsconfig.json

FROM node:20-alpine
WORKDIR /app/apps/api
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/packages/shared/dist /app/packages/shared/dist
COPY --from=build /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/seeds ./seeds
ENV PORT=4000
EXPOSE 4000
CMD ["node", "dist/index.js"]
