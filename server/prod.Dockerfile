FROM node:20.17.0

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

CMD ["node", "server.js"]
