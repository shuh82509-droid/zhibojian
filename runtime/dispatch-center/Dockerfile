FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S -g 10001 app \
 && adduser -S -D -H -u 10001 -G app app \
 && mkdir -p /app/data \
 && chown -R app:app /app
COPY --chown=app:app . .

USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -q -O - http://127.0.0.1:3000/api/health | grep -q '"ok":true' || exit 1
CMD ["node", "schedule-api-server.js"]
