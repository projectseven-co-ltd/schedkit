FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

FROM node:22-alpine
ARG GIT_SHA=unknown
ARG BUILD_DATE=unknown
ENV NODE_ENV=production
RUN apk add --no-cache ca-certificates wget \
  && addgroup -S app \
  && adduser -S -G app -u 10001 app
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY public ./public
COPY migrations ./migrations
COPY docker/entrypoint.sh /usr/local/bin/schedkit-entrypoint.sh
RUN chmod +x /usr/local/bin/schedkit-entrypoint.sh \
  && printf '%s\n' "$GIT_SHA" > /app/.git-sha \
  && mkdir -p public/captures \
  && chown -R app:app /app
USER app
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" >/dev/null || exit 1
LABEL org.opencontainers.image.source="https://github.com/projectseven-co-ltd/schedkit" \
  org.opencontainers.image.title="SchedKit API" \
  org.opencontainers.image.revision="${GIT_SHA}" \
  org.opencontainers.image.created="${BUILD_DATE}"
ENTRYPOINT ["schedkit-entrypoint.sh"]
CMD ["node", "src/index.mjs"]
