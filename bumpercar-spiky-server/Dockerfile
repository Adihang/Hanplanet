FROM node:22-alpine

WORKDIR /app

COPY bumpercar-spiky-server/package*.json ./
RUN npm ci --omit=dev

COPY bumpercar-spiky-server/ ./

EXPOSE 8080 8082

CMD ["node", "server.js"]
