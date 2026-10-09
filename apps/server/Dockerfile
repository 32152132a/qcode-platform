FROM node:24.19.0-bookworm-slim
WORKDIR /app/apps/server
COPY apps/server/package.json apps/server/package-lock.json ./
RUN npm ci --omit=dev
COPY apps/server/src ./src
COPY apps/server/public ./public
COPY apps/server/scripts ./scripts
COPY apps/client /app/apps/client
RUN node scripts/package-client.js && mkdir -p data backups && chown -R node:node /app
USER node
ENV HOST=0.0.0.0 PORT=3100 DB_PATH=/app/apps/server/data/qcode.sqlite
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
