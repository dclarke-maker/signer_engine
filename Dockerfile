FROM node:22-alpine AS dependencies

WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY . .
RUN pnpm build

# Migrations run drizzle-kit, which is a devDependency. This stage exists so the
# migrate service gets an image that still has it - targeting `build` used to
# work by accident until the prune below was reached, and every compose file
# pointed at it, so migrations failed with "drizzle-kit not found".
FROM build AS migrate

# Production dependencies only, for the runtime image.
FROM build AS pruned
RUN pnpm prune --prod

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
RUN addgroup --system signbridge && adduser --system --ingroup signbridge signbridge
COPY --from=pruned --chown=signbridge:signbridge /app/package.json ./
COPY --from=pruned --chown=signbridge:signbridge /app/node_modules ./node_modules
COPY --from=pruned --chown=signbridge:signbridge /app/dist ./dist
USER signbridge
EXPOSE 3000
CMD ["node", "dist/index.js"]
