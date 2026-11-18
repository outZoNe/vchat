use crate::protocol::{ClientTx, RoomMember, SignalMsg, encode_signal};
use bytes::Bytes;
use parking_lot::Mutex;
use sfu::ClientId;
use sfu::RoomId;
use std::{collections::HashMap, sync::atomic::AtomicU64};
use uuid::Uuid;

pub const CLIENT_QUEUE_CAP: usize = 256;
pub const WORKER_QUEUE_CAP: usize = 8192;
pub const DEFAULT_MAX_CLIENTS: usize = 10_000;

#[derive(Clone)]
struct MemberData {
    name: String,
    mic_enabled: bool,
}

impl MemberData {
    fn to_member(&self, id: ClientId) -> RoomMember {
        RoomMember {
            id,
            name: self.name.clone(),
            mic_enabled: self.mic_enabled,
        }
    }
}

struct ClientEntry {
    tx: ClientTx,
    room: Option<String>,
}

struct Inner {
    clients: HashMap<ClientId, ClientEntry>,
    rooms: HashMap<String, HashMap<ClientId, MemberData>>,
}

pub struct AppState {
    pub workers_tx: Vec<tokio::sync::mpsc::Sender<crate::protocol::SfuCommand>>,
    pub next_client_id: AtomicU64,
    pub max_clients: usize,
    inner: Mutex<Inner>,
}

impl AppState {
    pub fn new(
        workers_tx: Vec<tokio::sync::mpsc::Sender<crate::protocol::SfuCommand>>,
        max_clients: usize,
    ) -> Self {
        Self {
            workers_tx,
            next_client_id: AtomicU64::new(1),
            max_clients,
            inner: Mutex::new(Inner {
                clients: HashMap::new(),
                rooms: HashMap::new(),
            }),
        }
    }

    pub fn client_count(&self) -> usize {
        self.inner.lock().clients.len()
    }

    /// Регистрация; false если достигнут лимит подключений.
    pub fn try_register_client(&self, client_id: ClientId, tx: ClientTx) -> bool {
        let mut inner = self.inner.lock();
        if inner.clients.len() >= self.max_clients {
            return false;
        }
        inner.clients.insert(
            client_id,
            ClientEntry {
                tx,
                room: None,
            },
        );
        true
    }

    pub fn unregister_client(&self, client_id: ClientId) {
        let mut inner = self.inner.lock();
        let Some(entry) = inner.clients.remove(&client_id) else {
            return;
        };
        if let Some(room) = entry.room {
            Self::remove_and_notify(&mut inner, client_id, &room);
        }
    }

    pub fn lobby_snapshot_payload(&self) -> Bytes {
        let inner = self.inner.lock();
        let rooms: HashMap<String, Vec<RoomMember>> = inner
            .rooms
            .iter()
            .map(|(name, members)| {
                let list = members
                    .iter()
                    .map(|(&id, data)| data.to_member(id))
                    .collect();
                (name.clone(), list)
            })
            .collect();
        encode_signal(&SignalMsg::RoomsSnapshot { rooms })
    }

    pub fn join_room(&self, client_id: ClientId, room: &str, name: &str) -> RoomMember {
        let room = room.trim().to_string();
        let name = sanitize_name(name);
        let data = MemberData {
            name: name.clone(),
            mic_enabled: true,
        };
        let member = data.to_member(client_id);

        let mut inner = self.inner.lock();

        // Выход из предыдущей комнаты
        let prev_room = inner
            .clients
            .get(&client_id)
            .and_then(|c| c.room.clone());
        if let Some(prev) = prev_room {
            if prev != room {
                Self::remove_and_notify(&mut inner, client_id, &prev);
            }
        }

        inner
            .rooms
            .entry(room.clone())
            .or_default()
            .insert(client_id, data);

        if let Some(entry) = inner.clients.get_mut(&client_id) {
            entry.room = Some(room.clone());
        }

        let members: Vec<RoomMember> = inner
            .rooms
            .get(&room)
            .map(|m| m.iter().map(|(&id, d)| d.to_member(id)).collect())
            .unwrap_or_default();

        let joined_payload = encode_signal(&SignalMsg::MemberJoined {
            room: room.clone(),
            member: member.clone(),
        });
        let snapshot_payload = encode_signal(&SignalMsg::RoomSnapshot {
            room: room.clone(),
            members,
        });

        // Всем в lobby - имена участников; вступившему ещё полный snapshot комнаты
        Self::fanout_all(&inner, &joined_payload);
        Self::send_raw(&inner, client_id, snapshot_payload);

        member
    }

    pub fn set_name(&self, client_id: ClientId, name: &str) -> Option<RoomMember> {
        let name = sanitize_name(name);
        let mut inner = self.inner.lock();
        let room = inner.clients.get(&client_id)?.room.clone()?;
        let member = {
            let members = inner.rooms.get_mut(&room)?;
            let data = members.get_mut(&client_id)?;
            data.name = name;
            data.to_member(client_id)
        };
        let payload = encode_signal(&SignalMsg::MemberUpdated {
            room: room.clone(),
            member: member.clone(),
        });
        Self::fanout_all(&inner, &payload);
        Some(member)
    }

    pub fn set_mic(&self, client_id: ClientId, enabled: bool) -> Option<RoomMember> {
        let mut inner = self.inner.lock();
        let room = inner.clients.get(&client_id)?.room.clone()?;
        let member = {
            let members = inner.rooms.get_mut(&room)?;
            let data = members.get_mut(&client_id)?;
            data.mic_enabled = enabled;
            data.to_member(client_id)
        };
        let payload = encode_signal(&SignalMsg::MemberUpdated {
            room: room.clone(),
            member: member.clone(),
        });
        Self::fanout_all(&inner, &payload);
        Some(member)
    }

    pub fn leave_room(&self, client_id: ClientId) -> Option<String> {
        let mut inner = self.inner.lock();
        let room = {
            let entry = inner.clients.get_mut(&client_id)?;
            entry.room.take()?
        };
        Self::remove_and_notify(&mut inner, client_id, &room);
        Some(room)
    }

    fn remove_and_notify(inner: &mut Inner, client_id: ClientId, room: &str) {
        {
            let Some(members) = inner.rooms.get_mut(room) else {
                return;
            };
            members.remove(&client_id);
            if members.is_empty() {
                inner.rooms.remove(room);
            }
        }

        let left_payload = encode_signal(&SignalMsg::MemberLeft {
            room: room.to_string(),
            id: client_id,
        });
        Self::fanout_all(inner, &left_payload);
    }

    #[inline]
    fn send_raw(inner: &Inner, client_id: ClientId, payload: Bytes) {
        if let Some(entry) = inner.clients.get(&client_id) {
            let _ = entry.tx.try_send(payload);
        }
    }

    #[inline]
    fn fanout_all(inner: &Inner, payload: &Bytes) {
        for entry in inner.clients.values() {
            let _ = entry.tx.try_send(payload.clone());
        }
    }
}

pub fn sanitize_name(name: &str) -> String {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        "Anonymous".to_string()
    } else {
        trimmed.chars().take(32).collect()
    }
}

pub fn room_to_uuid(name: &str) -> RoomId {
    Uuid::new_v5(&Uuid::NAMESPACE_OID, name.as_bytes())
}

/// FNV-1a вместо SipHash: шардирование комнат на воркеры в hot path.
pub fn get_worker_index(room_name: &str, total_workers: usize) -> usize {
    if total_workers <= 1 {
        return 0;
    }
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in room_name.trim().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    (hash as usize) % total_workers
}
