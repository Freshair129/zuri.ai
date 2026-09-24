# Market Intelligence service image (ADR-108 D5). Built from the repository root
# with `-f services/market-intelligence/Dockerfile`; Dockerfile.dockerignore limits the
# context to this package, so no apps/server source, Next build or Prisma client can
# reach the image, and nothing is mounted at runtime.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /opt/market-intelligence
COPY services/market-intelligence/package.json services/market-intelligence/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY services/market-intelligence/src ./src
COPY services/market-intelligence/contracts ./contracts
USER node
EXPOSE 3082
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.MARKET_PORT||3082)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/main.js"]
