use crate::{
    protocol::{ClientTx, SfuCommand, SignalMsg, encode_signal},
    udp_out,
};
use bytes::BytesMut;
use rtc::{
    peer_connection::sdp::{RTCSdpType, RTCSessionDescription},
    peer_connection::transport::RTCIceCandidateInit,
    shared::{TaggedBytesMut, TransportContext, TransportProtocol},
};
use sansio::Protocol;
use sfu::{ClientId, RequestId, SFUEvent, Sfu, SfuId, TaggedSFUEvent};
use socket2::{Domain, Protocol as SockProtocol, Socket, Type};
use std::{collections::HashMap, net::SocketAddr, time::Instant};
use tokio::{net::UdpSocket, sync::mpsc};

const UDP_BUF_SIZE: usize = 16 * 1024 * 1024;

pub async fn run_worker(
    worker_id: usize,
    bind_addr: SocketAddr,
    advertise_addr: SocketAddr,
    mut rx: mpsc::Receiver<SfuCommand>,
) {
    let udp_socket = bind_udp(bind_addr, worker_id).await;

    // ICE-кандидат = advertise_addr. В TransportContext тоже он, иначе при bind 0.0.0.0
    // (Docker) connectivity check не сходится с кандидатом.
    let mut sfu = Sfu::new(worker_id as u32 as SfuId, advertise_addr);
    let mut clients: HashMap<ClientId, ClientTx> = HashMap::new();
    let mut req_counter: RequestId = 1;
    let mut read_buf = BytesMut::with_capacity(65536);
    let mut out_queue = udp_out::new_queue();

    loop {
        let timeout = sfu.poll_timeout();

        tokio::select! {
            biased;

            Ok((_len, mut remote_addr)) = udp_socket.recv_buf_from(&mut read_buf) => {
                let batch_now = Instant::now();

                loop {
                    let pkt = TaggedBytesMut {
                        now: batch_now,
                        transport: TransportContext {
                            local_addr: advertise_addr,
                            peer_addr: remote_addr,
                            ecn: None,
                            transport_protocol: TransportProtocol::UDP,
                        },
                        message: read_buf.split(),
                    };
                    let _ = sfu.handle_read(pkt);

                    if read_buf.capacity() < 2000 {
                        read_buf = BytesMut::with_capacity(65536);
                    }

                    match udp_socket.try_recv_buf_from(&mut read_buf) {
                        Ok((_next_len, next_addr)) => remote_addr = next_addr,
                        Err(_) => break,
                    }
                }
            }

            Some(first_cmd) = rx.recv() => {
                process_sfu_command(&mut sfu, &mut clients, &mut req_counter, first_cmd);
                while let Ok(next_cmd) = rx.try_recv() {
                    process_sfu_command(&mut sfu, &mut clients, &mut req_counter, next_cmd);
                }
            }

            _ = sleep_until_deadline(timeout) => {}
        }

        let _ = sfu.handle_timeout(Instant::now());
        while sfu.poll_read().is_some() {}
        udp_out::drain_sfu(&mut sfu, &mut out_queue);
        udp_out::flush(&udp_socket, &mut out_queue).await;
        drain_sfu_events(&mut sfu, &clients);
    }
}

async fn sleep_until_deadline(timeout: Option<Instant>) {
    match timeout {
        Some(deadline) => {
            let dur = deadline.saturating_duration_since(Instant::now());
            if !dur.is_zero() {
                tokio::time::sleep(dur).await;
            }
        }
        // Нет таймера SFU - не жжём CPU 20ms sleep'ами, ждём UDP/cmd
        None => std::future::pending::<()>().await,
    }
}

async fn bind_udp(bind_addr: SocketAddr, worker_id: usize) -> UdpSocket {
    let domain = if bind_addr.is_ipv4() {
        Domain::IPV4
    } else {
        Domain::IPV6
    };
    let socket = Socket::new(domain, Type::DGRAM, Some(SockProtocol::UDP)).unwrap_or_else(|e| {
        panic!("Воркер {}: socket: {}", worker_id, e)
    });

    socket.set_reuse_address(true).ok();
    socket.set_nonblocking(true).ok();
    let _ = socket.set_recv_buffer_size(UDP_BUF_SIZE);
    let _ = socket.set_send_buffer_size(UDP_BUF_SIZE);

    socket.bind(&bind_addr.into()).unwrap_or_else(|e| {
        panic!(
            "Воркер {}: не удалось занять UDP {}: {}",
            worker_id, bind_addr, e
        )
    });

    UdpSocket::from_std(socket.into()).unwrap_or_else(|e| {
        panic!("Воркер {}: tokio UDP: {}", worker_id, e)
    })
}

fn process_sfu_command(
    sfu: &mut Sfu,
    clients: &mut HashMap<ClientId, ClientTx>,
    req_counter: &mut RequestId,
    cmd: SfuCommand,
) {
    *req_counter += 1;
    let rid_seq = *req_counter;
    let batch_now = Instant::now();

    match cmd {
        SfuCommand::Signal {
            room_id,
            client_id,
            msg,
            reply_tx,
        } => {
            if let Some(tx) = reply_tx {
                clients.insert(client_id, tx);
            }

            let evt = match msg {
                SignalMsg::Join { .. } => Some(SFUEvent::Join {
                    request_id: rid_seq,
                    room_id,
                    client_id,
                }),
                SignalMsg::Offer { sdp, request_id } => {
                    // Для publish-offer request_id не важен; для SFU важно, что нет
                    // активной subscribe-транзакции (иначе ErrTransactionExists).
                    let rid = request_id.unwrap_or(rid_seq);
                    RTCSessionDescription::offer(sdp).ok().map(|desc| {
                        SFUEvent::SessionDescription {
                            request_id: rid,
                            room_id,
                            client_id,
                            sdp: desc,
                        }
                    })
                }
                SignalMsg::Answer { sdp, request_id } => {
                    // request_id обязателен: должен совпасть с id re-offer SFU.
                    // Подставлять rid_seq нельзя, будет ErrTransactionNotExists.
                    match request_id {
                        Some(rid) => RTCSessionDescription::answer(sdp).ok().map(|desc| {
                            SFUEvent::SessionDescription {
                                request_id: rid,
                                room_id,
                                client_id,
                                sdp: desc,
                            }
                        }),
                        None => {
                            eprintln!(
                                "[SFU] Answer без request_id от клиента {}, игнор",
                                client_id
                            );
                            None
                        }
                    }
                }
                SignalMsg::Candidate {
                    candidate,
                    sdp_mid,
                    sdp_m_line_index,
                } => Some(SFUEvent::IceCandidate {
                    request_id: rid_seq,
                    room_id,
                    client_id,
                    candidate: RTCIceCandidateInit {
                        candidate,
                        sdp_mid,
                        sdp_mline_index: sdp_m_line_index,
                        username_fragment: None,
                        url: None,
                    },
                }),
                SignalMsg::Leave => Some(SFUEvent::Leave {
                    request_id: rid_seq,
                    room_id,
                    client_id,
                    reason: "user left".to_owned(),
                }),
                SignalMsg::Hello { .. }
                | SignalMsg::RoomsSnapshot { .. }
                | SignalMsg::RoomSnapshot { .. }
                | SignalMsg::RoomCount { .. }
                | SignalMsg::SetName { .. }
                | SignalMsg::SetMic { .. }
                | SignalMsg::MemberJoined { .. }
                | SignalMsg::MemberLeft { .. }
                | SignalMsg::MemberUpdated { .. } => None,
            };

            if let Some(event) = evt {
                if let Err(err) = sfu.handle_event(TaggedSFUEvent {
                    now: batch_now,
                    event,
                }) {
                    eprintln!("[SFU] Ошибка события (клиент {}): {:?}", client_id, err);
                }
            }
        }
        SfuCommand::Disconnect { room_id, client_id } => {
            if clients.remove(&client_id).is_some() {
                if let Some(rid) = room_id {
                    let _ = sfu.handle_event(TaggedSFUEvent {
                        now: batch_now,
                        event: SFUEvent::Leave {
                            request_id: rid_seq,
                            room_id: rid,
                            client_id,
                            reason: "disconnected".to_owned(),
                        },
                    });
                }
            }
        }
    }
}

fn drain_sfu_events(sfu: &mut Sfu, clients: &HashMap<ClientId, ClientTx>) {
    while let Some(tagged) = sfu.poll_event() {
        match tagged.event {
            SFUEvent::SessionDescription {
                request_id,
                client_id,
                sdp,
                ..
            } => {
                if let Some(tx) = clients.get(&client_id) {
                    // request_id нужен клиенту только для re-offer (чтобы эхом вернуть в answer)
                    let out_msg = if sdp.sdp_type == RTCSdpType::Offer {
                        SignalMsg::Offer {
                            sdp: sdp.sdp,
                            request_id: Some(request_id),
                        }
                    } else {
                        SignalMsg::Answer {
                            sdp: sdp.sdp,
                            request_id: None,
                        }
                    };
                    let _ = tx.try_send(encode_signal(&out_msg));
                }
            }
            SFUEvent::IceCandidate {
                client_id,
                candidate,
                ..
            } => {
                if let Some(tx) = clients.get(&client_id) {
                    let _ = tx.try_send(encode_signal(&SignalMsg::Candidate {
                        candidate: candidate.candidate,
                        sdp_mid: candidate.sdp_mid,
                        sdp_m_line_index: candidate.sdp_mline_index,
                    }));
                }
            }
            _ => {}
        }
    }
}
