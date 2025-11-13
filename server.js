import {WebSocketServer} from "ws";
import express from "express";
import http from "http";

const app = express();
app.use(express.static("."));

const server = http.createServer(app);
const wss = new WebSocketServer({server, path: "/ws"});

let clients = [];

wss.on("connection", (ws) => {
  clients.push(ws);
  console.log("Client connected. Total:", clients.length);

  ws.on("message", (msg) => {
    // Рассылаем всем кроме отправителя
    for (const client of clients) {
      if (client !== ws && client.readyState === 1) {
        client.send(msg);
      }
    }
  });

  ws.on("close", () => {
    clients = clients.filter(c => c !== ws);
    console.log("Client disconnected. Total:", clients.length);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
