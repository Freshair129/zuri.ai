# @spec ADR-107 - isolated file-management runtime image.
FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /srv/file-management

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY src ./src
COPY migrations ./migrations
COPY contracts ./contracts

USER node
EXPOSE 4401
HEALTHCHECK --interval=20s --timeout=3s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:4401/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/main.js"]
