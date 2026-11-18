use crate::{
    protocol::{SfuCommand, SignalMsg, encode_signal},
    state::{AppState, CLIENT_QUEUE_CAP, get_worker_index, room_to_uuid, sanitize_name},
};
use futures_util::{SinkExt, StreamExt};
use sfu::RoomId;
use std::{
    sync::{Arc, atomic::Ordering},
    time::Duration,
};
use tokio::{net::TcpStream, sync::mpsc};
use tokio_tungstenite::{
    accept_async,
    tungstenite::{Message, protocol::frame::Utf8Bytes},
};

pub async fn handle_ws(stream: TcpStream, state: Arc<AppState>) {
    let _ = stream.set_nodelay(true);

    let Ok(ws_stream) = accept_async(stream).await else {
        return;
    };

    if state.client_count() >= state.max_clients {
        return;
    }

    let client_id = state.next_client_id.fetch_add(1, Ordering::Relaxed);
    let (tx, mut rx) = mpsc::channel(CLIENT_QUEUE_CAP);

    if !state.try_register_client(client_id, tx.clone()) {
        return;
    }

    let _ = tx.try_send(encode_signal(&SignalMsg::Hello { client_id }));
    let _ = tx.try_send(state.lobby_snapshot_payload());

    let (mut ws_sender, mut ws_receiver) = ws_stream.split();

    let send_task = tokio::spawn(async move {
        let mut ping_interval = tokio::time::interval(Duration::from_secs(10));
        ping_interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                biased;
                msg = rx.recv() => {
                    let Some(payload) = msg else { break; };
                    let Ok(text) = Utf8Bytes::try_from(payload) else { break; };
                    if ws_sender.send(Message::Text(text)).await.is_err() {
                        break;
                    }
                }
                _ = ping_interval.tick() => {
                    if ws_sender.send(Message::Ping(Vec::new().into())).await.is_err() {
                        break;
                    }
                }
            }
        }
    });

    let mut current_room: Option<RoomId> = None;
    let mut current_worker: Option<usize> = None;
    let mut display_name = String::from("Anonymous");

    while let Ok(Some(Ok(msg))) =
        tokio::time::timeout(Duration::from_secs(25), ws_receiver.next()).await
    {
        let Message::Text(text) = msg else {
            continue;
        };
        let Ok(signal) = serde_json::from_str::<SignalMsg>(text.as_str()) else {
            continue;
        };

        match signal {
            SignalMsg::SetName { name } => {
                display_name = sanitize_name(&name);
                let _ = state.set_name(client_id, &display_name);
            }
            SignalMsg::SetMic { enabled } => {
                let _ = state.set_mic(client_id, enabled);
            }
            SignalMsg::Join { room, name } => {
                if !name.trim().is_empty() {
                    display_name = sanitize_name(&name);
                }

                if let (Some(old_rid), Some(old_w)) = (current_room, current_worker) {
                    let _ = state.workers_tx[old_w]
                        .try_send(SfuCommand::Disconnect {
                            room_id: Some(old_rid),
                            client_id,
                        });
                }

                let room_name = room.trim().to_string();
                if room_name.is_empty() {
                    continue;
                }

                state.join_room(client_id, &room_name, &display_name);

                let rid = room_to_uuid(&room_name);
                let w_idx = get_worker_index(&room_name, state.workers_tx.len());
                current_room = Some(rid);
                current_worker = Some(w_idx);

                let _ = state.workers_tx[w_idx].try_send(SfuCommand::Signal {
                    room_id: rid,
                    client_id,
                    msg: SignalMsg::Join {
                        room: room_name,
                        name: display_name.clone(),
                    },
                    reply_tx: Some(tx.clone()),
                });
            }
            SignalMsg::Leave => {
                let _ = state.leave_room(client_id);
                if let (Some(rid), Some(w_idx)) = (current_room.take(), current_worker.take()) {
                    let _ = state.workers_tx[w_idx].try_send(SfuCommand::Signal {
                        room_id: rid,
                        client_id,
                        msg: SignalMsg::Leave,
                        reply_tx: None,
                    });
                }
            }
            SignalMsg::Offer { .. }
            | SignalMsg::Answer { .. }
            | SignalMsg::Candidate { .. } => {
                if let (Some(rid), Some(w_idx)) = (current_room, current_worker) {
                    let _ = state.workers_tx[w_idx].try_send(SfuCommand::Signal {
                        room_id: rid,
                        client_id,
                        msg: signal,
                        reply_tx: None,
                    });
                }
            }
            SignalMsg::Hello { .. }
            | SignalMsg::RoomsSnapshot { .. }
            | SignalMsg::RoomSnapshot { .. }
            | SignalMsg::RoomCount { .. }
            | SignalMsg::MemberJoined { .. }
            | SignalMsg::MemberLeft { .. }
            | SignalMsg::MemberUpdated { .. } => {}
        }
    }

    // Один leave через unregister (без повторного MemberLeft)
    state.unregister_client(client_id);
    if let Some(w_idx) = current_worker {
        let _ = state.workers_tx[w_idx].try_send(SfuCommand::Disconnect {
            room_id: current_room,
            client_id,
        });
    }
    send_task.abort();
}
