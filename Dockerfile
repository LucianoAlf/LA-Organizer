FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl
COPY package.json package-lock.json* ./
RUN npm ci --only=production
COPY src/ ./src/
COPY soul/ ./soul/
COPY skills/ ./skills/
RUN mkdir -p /app/logs
EXPOSE 3100
CMD ["node", "src/index.js"]
