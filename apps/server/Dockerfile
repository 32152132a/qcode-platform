FROM node:24.19.0-bookworm-slim AS admin-build
WORKDIR /admin
COPY apps/admin/package.json apps/admin/package-lock.json ./
RUN npm ci --ignore-scripts
COPY apps/admin/index.html apps/admin/tsconfig.json apps/admin/vite.config.ts ./
COPY apps/admin/src ./src
COPY apps/client/api-contract.mjs /client/api-contract.mjs
RUN npm run build

FROM node:24.19.0-bookworm-slim
WORKDIR /app/apps/server
COPY apps/server/package.json apps/server/package-lock.json ./
RUN npm ci --omit=dev
COPY apps/server/src ./src
COPY apps/client/api-contract.mjs /app/apps/client/api-contract.mjs
COPY apps/server/public ./public
COPY --from=admin-build /admin/dist ./public/console
COPY apps/server/scripts ./scripts
RUN mkdir -p data backups releases && chown -R node:node /app
USER node
ENV HOST=0.0.0.0 PORT=3100 DB_PATH=/app/apps/server/data/qcode.sqlite
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3100/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
