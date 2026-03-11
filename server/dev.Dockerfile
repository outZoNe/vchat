FROM node:20.17.0

WORKDIR /app

COPY package*.json ./
RUN npm ci && npm install -g nodemon

CMD ["nodemon", "server.js", "--watch", ".", "--ext", "js,json"]
