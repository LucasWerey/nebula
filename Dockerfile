FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY --from=web /web/dist ./web/dist
USER node
EXPOSE 7878
CMD ["node", "server.js"]
