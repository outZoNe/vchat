mod protocol;
mod state;
mod udp_out;
mod worker;
mod ws;

use state::{AppState, DEFAULT_MAX_CLIENTS, WORKER_QUEUE_CAP};
use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    sync::Arc,
};
use tokio::{net::TcpListener, sync::mpsc};

#[tokio::main]
async fn main() {
    // Локальный `cargo run` / watch: подхватываем .env как в docker-compose
    let _ = dotenvy::dotenv();

    // Публичный адрес для ICE-кандидатов (IP:port). В Docker - внешний IP хоста.
    // MEDIA_ADDR приоритетнее; иначе MEDIA_IP:3478 (как в compose).
    let media_advertise = resolve_media_addr();

    // На каком интерфейсе слушать UDP (в контейнере обычно 0.0.0.0)
    let media_bind_ip: IpAddr = std::env::var("MEDIA_BIND_IP")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED));

    let ws_addr = std::env::var("WS_ADDR").unwrap_or_else(|_| "0.0.0.0:8080".to_string());

    let max_clients = std::env::var("MAX_CLIENTS")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or(DEFAULT_MAX_CLIENTS);

    let total_cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let worker_count = std::env::var("WORKER_COUNT")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .unwrap_or_else(|| total_cores.saturating_sub(2).max(1));

    let base_port = media_advertise.port();
    let mut workers_tx = Vec::with_capacity(worker_count);

    for worker_id in 0..worker_count {
        let (tx, rx) = mpsc::channel(WORKER_QUEUE_CAP);
        workers_tx.push(tx);

        let port = base_port + worker_id as u16;
        let bind_addr = SocketAddr::new(media_bind_ip, port);
        let advertise_addr = SocketAddr::new(media_advertise.ip(), port);
        tokio::spawn(worker::run_worker(worker_id, bind_addr, advertise_addr, rx));
    }

    let state = Arc::new(AppState::new(workers_tx, max_clients));

    let ws_listener = TcpListener::bind(&ws_addr)
        .await
        .expect("Не удалось занять WS-порт");

    println!(
        "VChat запущен! WS: {} | Воркеров SFU: {} (ядер: {}) | max clients: {} | UDP bind {}:{}..{} | ICE advertise {}:{}..{}",
        ws_addr,
        worker_count,
        total_cores,
        max_clients,
        media_bind_ip,
        base_port,
        base_port + worker_count as u16 - 1,
        media_advertise.ip(),
        base_port,
        base_port + worker_count as u16 - 1
    );

    while let Ok((stream, _)) = ws_listener.accept().await {
        if state.client_count() >= state.max_clients {
            continue;
        }
        tokio::spawn(ws::handle_ws(stream, state.clone()));
    }
}

fn resolve_media_addr() -> SocketAddr {
    if let Ok(addr) = std::env::var("MEDIA_ADDR") {
        return addr
            .parse()
            .expect("Неверный формат MEDIA_ADDR (ожидается IP:port)");
    }
    let ip = std::env::var("MEDIA_IP").unwrap_or_else(|_| "127.0.0.1".to_string());
    format!("{ip}:3478")
        .parse()
        .expect("Неверный MEDIA_IP")
}
