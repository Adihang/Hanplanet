FROM node:22-alpine

WORKDIR /app

COPY map-collab-server/package*.json ./
RUN npm ci --omit=dev

COPY map-collab-server/ ./

EXPOSE 8083 8084

CMD ["node", "server.js"]
