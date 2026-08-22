FROM node:22-alpine AS dependencies

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .
RUN pnpm build
RUN pnpm prune --prod

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup --system signbridge && adduser --system --ingroup signbridge signbridge
COPY --from=build --chown=signbridge:signbridge /app/package.json ./
COPY --from=build --chown=signbridge:signbridge /app/node_modules ./node_modules
COPY --from=build --chown=signbridge:signbridge /app/dist ./dist
USER signbridge
EXPOSE 3000
CMD ["node", "dist/index.js"]
