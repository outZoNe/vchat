class WebSocketManager {
  ws = null;
  listeners = new Set(); // Set<function>
  reconnectTimeout = null;
  heartbeatInterval = null;

  connect(url) {
    if (this.ws) return; // уже подключён

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.info('[WS] connected');

      // запускаем heartbeat
      this.startHeartbeat();

      this.emit({ type: 'wsConnected', value: true });
    };

    this.ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        console.error('WS parse error:', e);
        return;
      }

      if (data.type === 'pong') return; // heartbeat ответ
      this.emit(data);
    };

    this.ws.onclose = () => {
      console.info('[WS] closed');
      this.emit({ type: 'wsConnected', value: false });

      this.ws = null;
      this.stopHeartbeat();
      this.scheduleReconnect(url);
    };

    this.ws.onerror = () => {
      console.warn('[WS] error');
      this.emit({ type: 'wsConnected', value: false });
    };
  }

  scheduleReconnect(url) {
    if (this.reconnectTimeout) return;

    this.reconnectTimeout = setTimeout(() => {
      console.info('[WS] reconnecting...');
      this.reconnectTimeout = null;
      this.connect(url);
    }, 2000);
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 10000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  emit(data) {
    this.listeners.forEach((fn) => fn(data));
  }

  send(data) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  subscribe(handler) {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }
}

export const WS = new WebSocketManager();
