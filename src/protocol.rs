use bytes::Bytes;
use serde::{Deserialize, Serialize};
use sfu::{ClientId, RequestId, RoomId};
use std::collections::HashMap;
use tokio::sync::mpsc;

fn default_true() -> bool {
    true
}

/// Исходящий JSON в WS (refcount, без повторной сериализации на broadcast).
pub type ClientTx = mpsc::Sender<Bytes>;

pub fn encode_signal(msg: &SignalMsg) -> Bytes {
    Bytes::from(serde_json::to_vec(msg).unwrap_or_else(|_| b"{}".to_vec()))
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RoomMember {
    pub id: ClientId,
    pub name: String,
    #[serde(default = "default_true")]
    pub mic_enabled: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SignalMsg {
    /// Сервер отдаёт клиенту его id после подключения WS
    #[serde(rename_all = "camelCase")]
    Hello {
        client_id: ClientId,
    },
    /// Снимок всех комнат и участников (lobby)
    #[serde(rename_all = "camelCase")]
    RoomsSnapshot {
        rooms: HashMap<String, Vec<RoomMember>>,
    },
    /// Полный список участников одной комнаты (после join)
    #[serde(rename_all = "camelCase")]
    RoomSnapshot {
        room: String,
        members: Vec<RoomMember>,
    },
    /// Счётчик комнаты (опционально; имена идут через Member*)
    #[serde(rename_all = "camelCase")]
    RoomCount {
        room: String,
        count: u32,
    },
    #[serde(rename_all = "camelCase")]
    Join {
        room: String,
        #[serde(default)]
        name: String,
    },
    #[serde(rename_all = "camelCase")]
    SetName {
        name: String,
    },
    #[serde(rename_all = "camelCase")]
    SetMic {
        enabled: bool,
    },
    #[serde(rename_all = "camelCase")]
    MemberJoined {
        room: String,
        member: RoomMember,
    },
    #[serde(rename_all = "camelCase")]
    MemberLeft {
        room: String,
        id: ClientId,
    },
    #[serde(rename_all = "camelCase")]
    MemberUpdated {
        room: String,
        member: RoomMember,
    },
    #[serde(rename_all = "camelCase")]
    Offer {
        sdp: String,
        #[serde(default)]
        request_id: Option<RequestId>,
    },
    #[serde(rename_all = "camelCase")]
    Answer {
        sdp: String,
        #[serde(default)]
        request_id: Option<RequestId>,
    },
    #[serde(rename_all = "camelCase")]
    Candidate {
        candidate: String,
        sdp_mid: Option<String>,
        sdp_m_line_index: Option<u16>,
    },
    Leave,
}

pub enum SfuCommand {
    Signal {
        room_id: RoomId,
        client_id: ClientId,
        msg: SignalMsg,
        reply_tx: Option<ClientTx>,
    },
    Disconnect {
        room_id: Option<RoomId>,
        client_id: ClientId,
    },
}
