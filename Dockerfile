FROM node:26.13.1-bookworm-slim AS verify
WORKDIR /app
COPY . .
RUN npm run verify

FROM node:26.13.1-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DB_PATH=/app/data/incidents.db DEMO_ENABLED=false
WORKDIR /app
COPY --from=verify --chown=node:node /app/src ./src
COPY --from=verify --chown=node:node /app/public ./public
COPY --from=verify --chown=node:node /app/models ./models
COPY --from=verify --chown=node:node /app/package.json ./package.json
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.js"]
