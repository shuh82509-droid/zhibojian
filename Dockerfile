FROM node:22-alpine AS collaboration-builder
WORKDIR /collaboration
COPY runtime/collaboration-center/package.json runtime/collaboration-center/package-lock.json ./
RUN npm ci
COPY runtime/collaboration-center/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN addgroup -S -g 10001 app && adduser -S -D -H -u 10001 -G app app
COPY server.js ./
COPY calendar-user-reader.mjs ./
COPY calendar-auth-http.mjs ./
COPY coach-calendar-auth.mjs ./
COPY frame-policy.mjs ./
COPY lifecycle-engine.mjs ./
COPY interview-binding.mjs ./
COPY lifecycle-reminder-lock.mjs ./
COPY durable-journal.mjs ./
COPY reminder-gates.mjs ./
COPY container-entrypoint.sh ./
COPY site/ ./public/
# The approved 2.0 layout is published as a separate trial route first.  The
# current production shell remains the default entry until the data-source
# preflight and user review have both passed.
COPY exports/morning-dashboard/ ./public/modules/morning/
COPY exports/recruitment-pool/ ./public/modules/recruitment/
COPY exports/anchor-archives/ ./public/modules/anchors/
COPY exports/material-center/ ./public/modules/materials/
COPY --from=collaboration-builder /collaboration/ ./collaboration/
RUN chown -R app:app /app
ENV PORT=3000 NODE_ENV=production
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O - http://127.0.0.1:3000/healthz || exit 1
CMD ["sh", "container-entrypoint.sh"]
