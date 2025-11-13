import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

// Статические файлы
app.use(express.static(path.join(__dirname, "public")));

// Хранение всех участников
const clients = new Map(); // id -> { ws, username, lastSeen }

wss.on("connection", (ws) => {
  const id = uuidv4();
  const defaultUsername = "Anonymous";
  clients.set(id, { ws, username: defaultUsername, lastSeen: Date.now() });
  console.log(`Client connected: ${id}, total: ${clients.size}`);

  // Отправляем клиенту его ID
  ws.send(JSON.stringify({ type: "set-id", id }));

  // Отправляем список всех СУЩЕСТВУЮЩИХ участников (их ID и username)
  const existingParticipants = [];
  for (const [peerId, client] of clients) {
    if (peerId !== id) {
      existingParticipants.push({ id: peerId, username: client.username });
    }
  }
  ws.send(JSON.stringify({ type: "existing-participants", participants: existingParticipants }));
  console.log(`Sent ${existingParticipants.length} existing participants to ${id}`);

  // Оповещаем все клиенты о новом участнике (включая его username сразу)
  broadcast({
    type: "new-participant",
    id,
    username: defaultUsername
  }, ws);

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      // обновляем метку активности
      const client = clients.get(id);
      if (client) client.lastSeen = Date.now();

      console.log(`[MSG from ${id}] type: ${data.type}, to: ${data.to || 'broadcast'}`);

      // ===== ОБРАБОТКА ВСЕХ ТИПОВ СООБЩЕНИЙ =====
      if (data.type === "pong") {
        // Ответ на ping — ничего не делаем, lastSeen уже обновлён
        return;
      }

      if (data.type === "update-username") {
        const client = clients.get(id);
        if (client) client.username = data.username;
        broadcast({ type: "update-username", username: data.username, from: id }, ws);
        console.log(`  -> broadcast username update to ${clients.size - 1} others`);
        return;
      }

      // Если есть поле `to`, отправляем конкретному участнику
      if (data.to && clients.has(data.to)) {
        const target = clients.get(data.to).ws;
        if (target && target.readyState === 1) {
          target.send(JSON.stringify({ ...data, from: id }));
          console.log(`  -> sent to ${data.to}`);
        } else {
          console.warn(`  -> target ${data.to} not ready (state: ${target?.readyState})`);
        }
      } else if (!data.to) {
        // Рассылка всем кроме отправителя
        broadcast({ ...data, from: id }, ws);
        console.log(`  -> broadcast to ${clients.size - 1} others`);
      }
    } catch (err) {
      console.error(`Error handling message from ${id}:`, err);
    }
  });

  ws.on("close", () => {
    clients.delete(id);
    console.log(`Client disconnected: ${id}, total: ${clients.size}`);
    broadcast({ type: "participant-left", id }, ws);
  });

  ws.on("error", (err) => {
    console.error(`WebSocket error for ${id}:`, err);
  });
});

// Периодический ping (application-level heartbeat)
setInterval(() => {
  const now = Date.now();
  for (const [id, c] of clients) {
    try {
      // если не было активности > 90s — закрываем соединение
      if (now - (c.lastSeen || 0) > 90_000) {
        console.log("Closing stale ws for", id);
        try { c.ws.terminate(); } catch (e) { /* ignore */ }
        clients.delete(id);
        continue;
      }
      // посылаем heartbeat-запрос
      c.ws.send(JSON.stringify({ type: "ping", ts: now }));
    } catch (err) {
      console.warn("Heartbeat send failed for", id, err);
    }
  }
}, 30_000);

function broadcast(data, excludeWs) {
  const json = JSON.stringify(data);
  for (const { ws } of clients.values()) {
    if (ws !== excludeWs && ws && ws.readyState === 1) {
      ws.send(json);
    }
  }
}

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on PORT: ${PORT}`));
