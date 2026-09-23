FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /opt/conversation-runtime
COPY services/conversation-runtime/package.json ./package.json
COPY services/conversation-runtime/src ./src
COPY services/conversation-runtime/contracts ./contracts
USER node
EXPOSE 3081
CMD ["node", "src/main.js"]
