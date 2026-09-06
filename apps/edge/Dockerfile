FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

COPY package*.json tsconfig.json ./
RUN npm install

COPY . .
RUN npm run build

CMD ["node", "dist/cli/index.js", "conversation", "serve"]
