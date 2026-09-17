# Voicematics website. Build from the repository root so ../shared/types.ts is in the context:
#   docker build -f website/Dockerfile --build-arg NEXT_PUBLIC_BACKEND_URL=https://api.example.com .
FROM node:20-alpine AS deps
WORKDIR /repo/website
COPY website/package.json website/package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:20-alpine AS build
ARG NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8000
ENV NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_BACKEND_URL \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY shared ./shared
COPY website ./website
COPY --from=deps /repo/website/node_modules ./website/node_modules
WORKDIR /repo/website
RUN npm run build

FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3100 \
    HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S voicematics && adduser -S voicematics -G voicematics
# The standalone bundle is rooted at website/ (its own lockfile), so server.js sits at the top.
COPY --from=build --chown=voicematics:voicematics /repo/website/.next/standalone ./
COPY --from=build --chown=voicematics:voicematics /repo/website/.next/static ./.next/static
COPY --from=build --chown=voicematics:voicematics /repo/website/public ./public
USER voicematics
EXPOSE 3100
CMD ["node", "server.js"]
